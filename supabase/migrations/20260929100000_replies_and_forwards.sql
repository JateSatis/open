-- Ответы и пересылка.
--
-- Ответ — ссылки на сообщения того же чата, по порядку. Цитата не копирует
-- текст: облачко ответа показывает оригинал таким, какой он сейчас, — с
-- правками, а удалённый как «Сообщение удалено».
--
-- Пересылка, наоборот, копирует: пересланное — новое сообщение целевого
-- чата от имени переславшего, с теми же текстом и файлами, и живёт, даже
-- если оригинал удалят. Откуда оно, помнит отдельная строка `message_forwards`,
-- и её пишет только функция пересылки: иначе прямым запросом к PostgREST
-- можно было бы создать «Переслано от <известный человек>» с выдуманным
-- текстом.

-- =============================================================================
-- Ответы
-- =============================================================================
--
-- Составные внешние ключи на пару (id, chat_id) держат инвариант «ответ
-- только внутри того же чата» в схеме: ссылку на сообщение другого чата
-- база не примет, откуда бы ни пришла вставка. Позиция задаёт порядок
-- цитат и заодно ограничивает их число — как `position` у вложений.
--
-- `deleted_at` здесь нет намеренно: ссылка не удаляется сама по себе, она
-- живёт и умирает вместе с сообщением-ответом.

create table public.message_replies (
  id uuid primary key default gen_random_uuid (),
  chat_id uuid not null references public.chats (id) on delete cascade,
  message_id uuid not null,
  quoted_id uuid not null,
  position int not null check (position >= 0 and position < 100),
  created_at timestamptz not null default now(),
  constraint message_replies_message_fkey
    foreign key (message_id, chat_id) references public.messages (id, chat_id) on delete cascade,
  constraint message_replies_quoted_fkey
    foreign key (quoted_id, chat_id) references public.messages (id, chat_id) on delete cascade,
  constraint message_replies_not_self check (quoted_id <> message_id),
  constraint message_replies_position_key unique (message_id, position),
  constraint message_replies_quoted_key unique (message_id, quoted_id)
);

create index message_replies_quoted_id_idx on public.message_replies (quoted_id);

alter table public.message_replies enable row level security;

-- Какие сообщения процитированы — не секрет: переписка публична. Содержимое
-- цитаты всё равно читается из `messages`, под её политикой: удалённое не
-- отдаётся.
create policy "message_replies are readable by authenticated users"
  on public.message_replies for select
  to authenticated
  using (true);

-- Цитаты прикрепляются только к своему сообщению и только в той транзакции,
-- в которой оно создано: время сообщения по умолчанию — `now()`, то есть
-- начало транзакции, и в любой другой транзакции оно уже не совпадёт.
-- Дописать цитату к старому сообщению задним числом нельзя. `xmin` строки
-- для этого не годится: внутри вложенной транзакции (блок `exception` в
-- plpgsql) он свой, и честная отправка упала бы. Процитировать можно только живое
-- сообщение: подзапрос идёт под политикой `messages` и удалённое не находит.
-- Отправить само сообщение может лишь участник — посетитель ответить не может.
create policy "message_replies are attached by the author when sending"
  on public.message_replies for insert
  to authenticated
  with check (
    exists (
      select 1 from public.messages m
      where m.id = message_replies.message_id
        and m.chat_id = message_replies.chat_id
        and m.author_id = auth.uid()
        and m.created_at = now()
    )
    and exists (
      select 1 from public.messages q
      where q.id = message_replies.quoted_id
        and q.chat_id = message_replies.chat_id
    )
  );

revoke update, delete on public.message_replies from anon, authenticated;
revoke insert on public.message_replies from anon;

/**
 * Цитаты нового сообщения — по порядку. Общая для всех функций отправки:
 * ответ принимается одинаково, чем бы он ни был — текстом, альбомом или
 * голосовым. Security invoker: вставка идёт под политикой выше.
 */
create function public.add_message_replies(new_message uuid, target_chat uuid, reply_to uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  wanted int;
begin
  wanted := coalesce(cardinality(reply_to), 0);

  if wanted = 0 then
    return;
  end if;

  if wanted > 100 then
    raise exception 'too many quoted messages' using errcode = '22023';
  end if;

  if cardinality(array(select distinct unnest(reply_to))) <> wanted then
    raise exception 'quoted messages repeat' using errcode = '22023';
  end if;

  -- Понятная ошибка раньше, чем сработает политика или внешний ключ: цитата
  -- из другого чата или удалённое сообщение (его не видно по SELECT-политике).
  if (
    select count(*) from public.messages
    where id = any (reply_to) and chat_id = target_chat
  ) <> wanted then
    raise exception 'quoted message not found' using errcode = 'P0002';
  end if;

  insert into public.message_replies (chat_id, message_id, quoted_id, position)
  select target_chat, new_message, quoted.id, (quoted.ord - 1)::int
  from unnest(reply_to) with ordinality as quoted(id, ord);
end;
$$;

revoke execute on function public.add_message_replies(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.add_message_replies(uuid, uuid, uuid[]) to authenticated;

-- =============================================================================
-- Отправка с ответом
-- =============================================================================
--
-- Те же функции, что в 20260926090000_attachment_poster.sql и
-- 20260926180000_voice_messages.sql, плюс `reply_to`. Старые сигнатуры
-- удаляются: две перегрузки с одним набором именованных аргументов PostgREST
-- не различит.

drop function public.send_media_message(uuid, text, jsonb);

create function public.send_media_message(
  target_chat uuid,
  message_text text,
  media jsonb,
  reply_to uuid[] default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_message_id uuid;
  new_kind text;
  item jsonb;
  item_index int := 0;
begin
  if media is null then
    media := '[]'::jsonb;
  end if;

  if jsonb_typeof(media) <> 'array' then
    raise exception 'media должен быть json-массивом';
  end if;

  if jsonb_array_length(media) > 50 then
    raise exception 'Нельзя отправить больше 50 файлов за раз';
  end if;

  new_kind := case when jsonb_array_length(media) = 0 then 'text' else 'media' end;

  insert into public.messages (chat_id, author_id, kind, text)
  values (target_chat, auth.uid(), new_kind, message_text)
  returning id into new_message_id;

  for item in select * from jsonb_array_elements(media)
  loop
    insert into public.attachments (
      message_id, message_kind, url, poster_url, mime_type, width, height, duration_ms,
      size_bytes, position
    ) values (
      new_message_id,
      new_kind,
      item ->> 'url',
      nullif(item ->> 'poster_url', ''),
      item ->> 'mime_type',
      nullif(item ->> 'width', '')::int,
      nullif(item ->> 'height', '')::int,
      nullif(item ->> 'duration_ms', '')::int,
      nullif(item ->> 'size_bytes', '')::bigint,
      item_index
    );

    item_index := item_index + 1;
  end loop;

  perform public.add_message_replies(new_message_id, target_chat, reply_to);

  return new_message_id;
end;
$$;

revoke execute on function public.send_media_message(uuid, text, jsonb, uuid[]) from public, anon;
grant execute on function public.send_media_message(uuid, text, jsonb, uuid[]) to authenticated;

drop function public.send_voice_message(uuid, jsonb);

create function public.send_voice_message(target_chat uuid, voice jsonb, reply_to uuid[] default null)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_message_id uuid;
  bars smallint[];
begin
  if voice is null or jsonb_typeof(voice) <> 'object' then
    raise exception 'voice должен быть json-объектом';
  end if;

  if voice -> 'waveform' is not null and jsonb_typeof(voice -> 'waveform') = 'array' then
    select array_agg(value::smallint order by ord)
    into bars
    from jsonb_array_elements_text(voice -> 'waveform') with ordinality as t(value, ord);
  end if;

  insert into public.messages (chat_id, author_id, kind)
  values (target_chat, auth.uid(), 'voice')
  returning id into new_message_id;

  insert into public.attachments (
    message_id, message_kind, url, mime_type, duration_ms, size_bytes, waveform, position
  ) values (
    new_message_id,
    'voice',
    voice ->> 'url',
    voice ->> 'mime_type',
    nullif(voice ->> 'duration_ms', '')::int,
    nullif(voice ->> 'size_bytes', '')::bigint,
    bars,
    0
  );

  perform public.add_message_replies(new_message_id, target_chat, reply_to);

  return new_message_id;
end;
$$;

revoke execute on function public.send_voice_message(uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.send_voice_message(uuid, jsonb, uuid[]) to authenticated;

-- =============================================================================
-- Пересылка
-- =============================================================================
--
-- Первоисточник, а не промежуточное звено: пересылка пересланного указывает
-- на исходное сообщение и его автора. Автор хранится здесь же, а не только
-- через ссылку на сообщение: строка «Переслано от» остаётся и тогда, когда
-- оригинал удалён. Удалённый аккаунт автора — `null`.

create table public.message_forwards (
  id uuid primary key default gen_random_uuid (),
  message_id uuid not null,
  origin_message_id uuid,
  origin_author_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint message_forwards_message_fkey
    foreign key (message_id) references public.messages (id) on delete cascade,
  constraint message_forwards_origin_fkey
    foreign key (origin_message_id) references public.messages (id) on delete set null,
  constraint message_forwards_message_key unique (message_id)
);

create index message_forwards_origin_message_id_idx on public.message_forwards (origin_message_id);
create index message_forwards_origin_author_id_idx on public.message_forwards (origin_author_id);

alter table public.message_forwards enable row level security;

create policy "message_forwards are readable by authenticated users"
  on public.message_forwards for select
  to authenticated
  using (true);

-- Политик на запись нет, и прав тоже: строку пишет только `forward_messages`.
revoke insert, update, delete on public.message_forwards from anon, authenticated;

/**
 * Пересланное — копия, и копией остаётся: дописать к нему файлы или
 * поменять текст нельзя, иначе «Переслано от» стояло бы над словами,
 * которых автор оригинала не писал. Функция пересылки кладёт вложения
 * раньше, чем строку `message_forwards`, поэтому её это не задевает.
 */
create function public.protect_forwarded_content()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'attachments' then
    if exists (select 1 from public.message_forwards where message_id = new.message_id) then
      raise exception 'forwarded messages cannot be changed' using errcode = '42501';
    end if;

    return new;
  end if;

  if new.text is distinct from old.text
     and exists (select 1 from public.message_forwards where message_id = new.id) then
    raise exception 'forwarded messages cannot be changed' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger on_attachment_added_to_forward
  before insert on public.attachments
  for each row execute function public.protect_forwarded_content();

create trigger on_forwarded_text_changed
  before update of text on public.messages
  for each row execute function public.protect_forwarded_content();

/**
 * Пересылает сообщения в чат, где вызывающий участник. Одна транзакция:
 * копии появляются в том порядке, в котором оригиналы шли в переписке, со
 * всеми вложениями — теми же файлами, без повторной загрузки, — и
 * возвращаются по порядку.
 *
 * Security definer, потому что пишет `message_forwards`, куда у клиента прав
 * нет. Поэтому центральное правило — писать только туда, где ты участник, —
 * проверяется здесь явно. Читать источник может кто угодно: посетитель
 * пересылает чужую переписку в свой чат, так она и расходится.
 */
create function public.forward_messages(target_chat uuid, message_ids uuid[])
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  wanted int;
  found int;
  source record;
  new_message_id uuid;
  stamp timestamptz;
  last_stamp timestamptz := '-infinity';
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.chat_members cm
    join public.chats c on c.id = cm.chat_id
    where cm.chat_id = target_chat and cm.user_id = caller and c.deleted_at is null
  ) then
    raise exception 'only chat members can forward messages here' using errcode = '42501';
  end if;

  wanted := coalesce(cardinality(array(select distinct unnest(message_ids))), 0);

  if wanted = 0 then
    return;
  end if;

  if wanted > 100 then
    raise exception 'too many messages in one call' using errcode = '22023';
  end if;

  -- for share: удаление оригинала в параллельной транзакции ждёт, пока копия
  -- не ляжет, — удалённое переслать нельзя, даже на гонке.
  perform 1 from public.messages
  where id = any (message_ids) and deleted_at is null
  for share;

  select count(*) into found
  from public.messages
  where id = any (message_ids) and deleted_at is null;

  if found <> wanted then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.messages where id = any (message_ids) and kind = 'system') then
    raise exception 'system messages cannot be forwarded' using errcode = '22023';
  end if;

  for source in
    select m.id, m.author_id, m.kind, m.text,
           f.id as forward_id, f.origin_message_id, f.origin_author_id
    from public.messages m
    left join public.message_forwards f on f.message_id = m.id
    where m.id = any (message_ids)
    order by m.created_at, m.id
  loop
    -- Время у всех копий одной транзакции было бы одинаковым (`now()`), и
    -- порядок в переписке стал бы случайным.
    stamp := greatest(clock_timestamp(), last_stamp + interval '1 microsecond');
    last_stamp := stamp;

    insert into public.messages (chat_id, author_id, kind, text, created_at)
    values (target_chat, caller, source.kind, source.text, stamp)
    returning id into new_message_id;

    insert into public.attachments (
      message_id, message_kind, url, poster_url, mime_type, width, height, duration_ms,
      size_bytes, waveform, position
    )
    select new_message_id, source.kind, a.url, a.poster_url, a.mime_type, a.width, a.height,
           a.duration_ms, a.size_bytes, a.waveform, a.position
    from public.attachments a
    where a.message_id = source.id
    order by a.position;

    insert into public.message_forwards (message_id, origin_message_id, origin_author_id)
    values (
      new_message_id,
      case when source.forward_id is null then source.id else source.origin_message_id end,
      case when source.forward_id is null then source.author_id else source.origin_author_id end
    );

    return next new_message_id;
  end loop;
end;
$$;

revoke execute on function public.forward_messages(uuid, uuid[]) from public, anon;
grant execute on function public.forward_messages(uuid, uuid[]) to authenticated;
