-- Каналы, этап 2: попсы.
--
-- Поп — вертикальное видео канала с необязательной подписью. Это отдельная
-- сущность канала, а не сообщение: у него будут свой просмотр, свои реакции и
-- комментарии (этап 3), и живёт он в сетке канала, а не в переписке.
--
-- Пост может показать поп — вложением-ссылкой: строка `attachments`, у
-- которой вместо своего файла ссылка на поп. Пост при этом остаётся обычным
-- сообщением вида `media` в чате постов: реакции, комментарии, просмотры,
-- ответы и пересылка — его собственные, как у любого поста.
--
-- Вложение-ссылка, а не колонка на сообщении — ради будущих альбомов «медиа +
-- попсы»: такой альбом — это несколько строк `attachments` по позициям, часть
-- со своими файлами, часть со ссылками. Сейчас ссылка в посте единственная
-- (`check_message_shape`); смешанный альбом — ослабление этой проверки и
-- правила «поп нельзя убрать правкой», а не новая модель.

-- =============================================================================
-- Право публиковать в канале
-- =============================================================================
--
-- Одно место на все функции публикации: пост, поп, пост с попом. Сейчас
-- публикует тот, кого канал сделал участником чата постов (владелец); когда
-- появятся модераторы с правом публикации, меняется только этот предикат.

create function public.can_publish_in_channel(target_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.channels ch
    join public.chat_members cm on cm.chat_id = ch.posts_chat_id
    where ch.id = target_channel
      and ch.deleted_at is null
      and cm.user_id = auth.uid()
  )
$$;

revoke execute on function public.can_publish_in_channel(uuid) from public, anon;
grant execute on function public.can_publish_in_channel(uuid) to authenticated;

-- =============================================================================
-- pops
-- =============================================================================
--
-- Файл попа — те же колонки, что у вложения. Обязательны: видео, постер (без
-- него сетка канала и обложка в посте — пустые прямоугольники), размеры и
-- длительность (плитка и обложка встают на место до загрузки файла).
-- Вертикальность и 90 секунд — продуктовые лимиты, они на клиенте.

create table public.pops (
  id uuid primary key default gen_random_uuid (),
  channel_id uuid not null references public.channels (id),
  author_id uuid references public.profiles (id) on delete set null,
  caption text,
  url text not null,
  poster_url text not null,
  mime_type text not null,
  width int not null,
  height int not null,
  duration_ms int not null,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint pops_is_video check (mime_type like 'video/%'),
  constraint pops_poster_not_blank check (btrim(poster_url) <> ''),
  constraint pops_url_not_blank check (btrim(url) <> ''),
  constraint pops_dimensions check (width > 0 and height > 0),
  constraint pops_duration check (duration_ms > 0),
  constraint pops_caption_not_blank check (caption is null or btrim(caption) <> '')
);

create index pops_channel_created_idx
  on public.pops (channel_id, created_at desc)
  where deleted_at is null;

create index pops_author_id_idx on public.pops (author_id);

alter table public.pops enable row level security;

create policy "pops are readable by authenticated users"
  on public.pops for select
  to authenticated
  using (deleted_at is null);

-- Политик на запись нет: попсы создают только функции публикации.
revoke insert, update, delete on public.pops from anon, authenticated;

-- =============================================================================
-- Вложение-ссылка на поп
-- =============================================================================

alter table public.attachments
  add column pop_id uuid references public.pops (id),
  alter column url drop not null;

-- Строка вложения — либо свой файл, либо ссылка на поп. У ссылки файловые
-- колонки пустые: файл, постер и размеры берутся у попа, и разойтись с ним
-- им негде.
alter table public.attachments
  add constraint attachments_file_or_pop check (
    num_nonnulls(url, pop_id) = 1
    and (
      pop_id is null
      or num_nonnulls(poster_url, mime_type, width, height, duration_ms, size_bytes, waveform) = 0
    )
  );

create index attachments_pop_id_idx on public.attachments (pop_id) where pop_id is not null;

-- Ссылку на поп кладут только функции публикации: прямая вставка вложения
-- остаётся для своих файлов, как раньше.
drop policy "attachments are added by the author when sending" on public.attachments;

create policy "attachments are added by the author when sending"
  on public.attachments for insert
  to authenticated
  with check (
    pop_id is null
    and exists (
      select 1 from public.messages m
      where m.id = attachments.message_id
        and m.author_id = auth.uid()
        and m.created_at = now()
    )
  );

/**
 * Поп показывает только пост его же канала и только живой поп: ссылка на поп
 * чужого канала подписала бы чужое видео своим каналом. Проверка в базе, а не
 * только в функции: правка пересобирает вложения заново.
 */
create function public.check_attachment_pop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.message_kind <> 'media' then
    raise exception 'Поп прикрепляется только к посту' using errcode = 'check_violation';
  end if;

  if not exists (
    select 1
    from public.pops p
    join public.channels ch on ch.id = p.channel_id
    join public.messages m on m.chat_id = ch.posts_chat_id
    where p.id = new.pop_id
      and p.deleted_at is null
      and m.id = new.message_id
  ) then
    raise exception 'Поп из другого канала' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.check_attachment_pop() from public, anon, authenticated;

create trigger attachments_check_pop
  before insert on public.attachments
  for each row
  when (new.pop_id is not null)
  execute function public.check_attachment_pop();

-- =============================================================================
-- Форма
-- =============================================================================

-- Та же функция, что в 20261004110000_comment_forwards.sql, плюс поп: пока
-- ссылка на поп в посте — единственное вложение. Смешанный альбом снимет
-- именно это условие.
create or replace function public.check_message_shape(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.messages;
  files int;
  pops int;
begin
  select * into m from public.messages where id = target;

  if m.id is null or m.deleted_at is not null then
    return;
  end if;

  select count(*), count(pop_id) into files, pops
  from public.attachments where message_id = target;

  if pops > 0 and (m.kind <> 'media' or files <> 1) then
    raise exception 'Поп в посте идёт без других вложений'
      using errcode = 'check_violation';
  end if;

  if m.kind = 'voice' and (files <> 1 or m.text is not null) then
    raise exception 'У голосового сообщения должно быть ровно одно вложение и нет подписи'
      using errcode = 'check_violation';
  end if;

  if m.kind = 'media' and files = 0 then
    raise exception 'В альбоме должен быть хотя бы один файл'
      using errcode = 'check_violation';
  end if;

  if m.kind = 'text' and (files > 0 or coalesce(btrim(m.text), '') = '') then
    raise exception 'Текстовое сообщение — непустой текст без вложений'
      using errcode = 'check_violation';
  end if;

  if m.kind = 'forward' and (
    files > 0
    or m.text is not null
    or m.source_chat_id is null
    or not exists (
      select 1 from public.forward_items i where i.forward_id = m.id and i.deleted_at is null
    )
  ) then
    raise exception 'Островок пересылки — только ссылки на оригиналы'
      using errcode = 'check_violation';
  end if;

  if m.kind = 'comment_forward' and (
    files > 0 or m.text is not null or m.forwarded_comment_id is null
  ) then
    raise exception 'Пересланный комментарий — только ссылка на комментарий'
      using errcode = 'check_violation';
  end if;
end;
$$;

-- =============================================================================
-- Превью
-- =============================================================================

-- Та же функция, что в 20261004110000_comment_forwards.sql, плюс пост с попом:
-- «🎬 Pop» и текст поста.
create or replace function public.message_preview_text(m public.messages)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  voice_ms int;
  items int;
  fc public.comments;
begin
  if m.stream_id is not null then
    return '📞 Звонок';
  end if;

  if m.kind = 'forward' then
    select count(*) into items
    from public.forward_items
    where forward_id = m.id and deleted_at is null;

    return 'Переслано: ' || items || ' ' || case
      when items % 10 = 1 and items % 100 <> 11 then 'сообщение'
      when items % 10 between 2 and 4 and (items % 100 < 12 or items % 100 > 14) then 'сообщения'
      else 'сообщений'
    end;
  end if;

  if m.kind = 'comment_forward' then
    select * into fc from public.comments where id = m.forwarded_comment_id;

    return '💬 ' || coalesce(
      case when fc.deleted_at is null then fc.text end,
      case
        when fc.deleted_at is not null or fc.id is null then 'Комментарий удалён'
        when fc.kind = 'media' then '📷 Медиа'
        when fc.kind = 'voice' then '🎤 Голосовое сообщение'
      end,
      'Комментарий'
    );
  end if;

  if m.kind = 'media' and exists (
    select 1 from public.attachments where message_id = m.id and pop_id is not null
  ) then
    return '🎬 Pop' || coalesce(': ' || m.text, '');
  end if;

  if m.text is not null then
    return m.text;
  end if;

  if m.kind = 'media' then
    return '📷 Медиа';
  end if;

  if m.kind = 'voice' then
    select duration_ms into voice_ms
    from public.attachments
    where message_id = m.id
    limit 1;

    if voice_ms is not null then
      return format(
        '🎤 Голосовое сообщение (%s:%s)',
        greatest(voice_ms / 1000, 1) / 60,
        lpad((greatest(voice_ms / 1000, 1) % 60)::text, 2, '0')
      );
    end if;

    return '🎤 Голосовое сообщение';
  end if;

  return m.text;
end;
$$;

-- =============================================================================
-- Публикация
-- =============================================================================

/**
 * Пост с попом в чате постов канала: сообщение вида `media` и одна строка
 * вложения-ссылки. Общая часть `publish_pop` и `send_pop_post`; право
 * публиковать проверяет вызывающая функция.
 *
 * Строка сообщения вставляется раньше вложения, и превью, посчитанное
 * триггером рассылки, ещё не знает о попе — поэтому оно пересчитывается здесь.
 */
create function public.insert_pop_post(
  posts_chat uuid,
  pop uuid,
  message_text text,
  reply_to uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_message public.messages;
begin
  insert into public.messages (chat_id, author_id, kind, text)
  values (posts_chat, auth.uid(), 'media', nullif(btrim(coalesce(message_text, '')), ''))
  returning * into new_message;

  insert into public.attachments (message_id, message_kind, pop_id, position)
  values (new_message.id, 'media', pop, 0);

  perform public.add_message_replies(new_message.id, posts_chat, reply_to);

  update public.chats
  set last_message_text = public.message_preview_text(new_message)
  where id = posts_chat;

  return new_message.id;
end;
$$;

revoke execute on function public.insert_pop_post(uuid, uuid, text, uuid[]) from public, anon, authenticated;

/**
 * Публикует поп в канале и, по флагу, в той же транзакции пост с ним.
 *
 * `new_pop` — id, который выбрал клиент: повтор после обрыва связи (ответ
 * потерялся, а транзакция прошла) отдаёт уже созданное, а не второй поп.
 * Файл попа (`media`) — объект с теми же полями, что вложение:
 * url, poster_url, mime_type, width, height, duration_ms, size_bytes.
 *
 * Отдаёт `{ pop_id, message_id }`; `message_id` — `null`, если поста нет.
 */
create function public.publish_pop(
  target_channel uuid,
  new_pop uuid,
  media jsonb,
  caption text default null,
  also_post boolean default false,
  post_text text default null,
  reply_to uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  posts_chat uuid;
  existing public.pops;
  new_message uuid;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if not public.can_publish_in_channel(target_channel) then
    raise exception 'Публиковать в канале может только его автор' using errcode = '42501';
  end if;

  if media is null or jsonb_typeof(media) <> 'object' then
    raise exception 'media должен быть json-объектом' using errcode = '22023';
  end if;

  select * into existing from public.pops where id = new_pop;

  if existing.id is not null then
    if existing.author_id is distinct from me or existing.channel_id <> target_channel then
      raise exception 'pop already exists' using errcode = '23505';
    end if;

    return jsonb_build_object(
      'pop_id', existing.id,
      'message_id', (
        select a.message_id from public.attachments a
        join public.messages m on m.id = a.message_id
        where a.pop_id = existing.id and m.author_id = me
        order by a.created_at
        limit 1
      )
    );
  end if;

  select posts_chat_id into posts_chat from public.channels where id = target_channel;

  insert into public.pops (
    id, channel_id, author_id, caption, url, poster_url, mime_type, width, height,
    duration_ms, size_bytes
  ) values (
    new_pop,
    target_channel,
    me,
    nullif(btrim(coalesce(caption, '')), ''),
    media ->> 'url',
    nullif(media ->> 'poster_url', ''),
    media ->> 'mime_type',
    nullif(media ->> 'width', '')::int,
    nullif(media ->> 'height', '')::int,
    nullif(media ->> 'duration_ms', '')::int,
    nullif(media ->> 'size_bytes', '')::bigint
  );

  if also_post then
    new_message := public.insert_pop_post(posts_chat, new_pop, post_text, reply_to);
  end if;

  return jsonb_build_object('pop_id', new_pop, 'message_id', new_message);
end;
$$;

revoke execute on function public.publish_pop(uuid, uuid, jsonb, text, boolean, text, uuid[]) from public, anon;
grant execute on function public.publish_pop(uuid, uuid, jsonb, text, boolean, text, uuid[]) to authenticated;

/** Пост с уже опубликованным попом этого канала. Отдаёт id поста. */
create function public.send_pop_post(
  target_chat uuid,
  pop uuid,
  message_text text default null,
  reply_to uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_channel uuid;
begin
  if auth.uid() is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  select id into target_channel from public.channels where posts_chat_id = target_chat;

  if target_channel is null or not public.can_publish_in_channel(target_channel) then
    raise exception 'Публиковать в канале может только его автор' using errcode = '42501';
  end if;

  return public.insert_pop_post(target_chat, pop, message_text, reply_to);
end;
$$;

revoke execute on function public.send_pop_post(uuid, uuid, text, uuid[]) from public, anon;
grant execute on function public.send_pop_post(uuid, uuid, text, uuid[]) to authenticated;

-- =============================================================================
-- Правка: поп в посте не убрать и не заменить
-- =============================================================================
--
-- Та же функция, что в 20261002100000_forward_islands.sql, плюс вложения-
-- ссылки: сохранённая ссылка переносится вместе с `pop_id`, а набор попсов
-- поста после правки обязан совпасть с прежним. Текст меняется как у любого
-- поста.

create or replace function public.edit_message(
  target_message uuid,
  message_text text,
  media jsonb default '[]'::jsonb,
  voice jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  m public.messages;
  old_files jsonb;
  new_text text := nullif(btrim(coalesce(message_text, '')), '');
  new_kind text;
  items jsonb;
  item jsonb;
  item_index int := 0;
  kept uuid;
  kept_row public.attachments;
  bars smallint[];
  new_urls text[] := '{}';
  old_urls text[];
  old_pops uuid[];
  latest uuid;
  member record;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if media is null then
    media := '[]'::jsonb;
  end if;

  if jsonb_typeof(media) <> 'array' then
    raise exception 'media должен быть json-массивом' using errcode = '22023';
  end if;

  if voice is not null and jsonb_typeof(voice) = 'null' then
    voice := null;
  end if;

  if voice is not null and jsonb_typeof(voice) <> 'object' then
    raise exception 'voice должен быть json-объектом' using errcode = '22023';
  end if;

  select * into m from public.messages where id = target_message for update;

  if m.id is null or m.deleted_at is not null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if m.author_id is distinct from caller then
    raise exception 'only own messages can be edited' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.chat_members where chat_id = m.chat_id and user_id = caller
  ) then
    raise exception 'only chat members can edit messages' using errcode = '42501';
  end if;

  if m.kind not in ('text', 'media', 'voice') then
    raise exception 'this message cannot be edited' using errcode = '22023';
  end if;

  if voice is not null then
    if new_text is not null or jsonb_array_length(media) > 0 then
      raise exception 'Голосовое идёт без подписи и без других вложений'
        using errcode = 'check_violation';
    end if;

    new_kind := 'voice';
    items := jsonb_build_array(voice);
  elsif jsonb_array_length(media) > 0 then
    if jsonb_array_length(media) > 50 then
      raise exception 'В альбоме не больше 50 файлов' using errcode = 'check_violation';
    end if;

    new_kind := 'media';
    items := media;
  elsif new_text is not null then
    new_kind := 'text';
    items := '[]'::jsonb;
  else
    raise exception 'Пустое сообщение сохранить нельзя' using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(items) as i(value)
    where i.value ? 'attachment_id'
      and not exists (
        select 1 from public.attachments a
        where a.message_id = m.id and a.id::text = i.value ->> 'attachment_id'
      )
  ) then
    raise exception 'attachment not found' using errcode = 'P0002';
  end if;

  if (
    select count(*) <> count(distinct i.value ->> 'attachment_id')
    from jsonb_array_elements(items) as i(value)
    where i.value ? 'attachment_id'
  ) then
    raise exception 'attachments repeat' using errcode = '22023';
  end if;

  -- Ссылка на поп сравнивается по попу: своего адреса у неё нет.
  select
    coalesce(array_agg(coalesce(url, 'pop:' || pop_id::text) order by position), '{}'),
    coalesce(array_agg(pop_id order by pop_id) filter (where pop_id is not null), '{}')
  into old_urls, old_pops
  from public.attachments where message_id = m.id;

  select coalesce(
    array_agg(
      coalesce(
        (select coalesce(a.url, 'pop:' || a.pop_id::text) from public.attachments a
         where a.message_id = m.id and a.id::text = i.value ->> 'attachment_id'),
        i.value ->> 'url'
      )
      order by i.ord
    ),
    '{}'
  )
  into new_urls
  from jsonb_array_elements(items) with ordinality as i(value, ord);

  if new_kind = m.kind and new_text is not distinct from m.text and new_urls = old_urls then
    return;
  end if;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.position), '[]'::jsonb) into old_files
  from public.attachments a where a.message_id = m.id;

  insert into public.message_revisions (
    message_id, chat_id, author_id, kind, text, attachments, version_at
  ) values (
    m.id, m.chat_id, m.author_id, m.kind, m.text, old_files, coalesce(m.edited_at, m.created_at)
  );

  delete from public.attachments where message_id = m.id;

  update public.messages
  set kind = new_kind, text = new_text, edited_at = now()
  where id = m.id;

  for item in select value from jsonb_array_elements(items)
  loop
    if item ? 'attachment_id' then
      kept := (item ->> 'attachment_id')::uuid;

      select * into kept_row
      from jsonb_populate_recordset(null::public.attachments, old_files)
      where id = kept;

      insert into public.attachments (
        id, message_id, message_kind, url, poster_url, mime_type, width, height, duration_ms,
        size_bytes, waveform, position, created_at, pop_id
      ) values (
        kept_row.id, m.id, new_kind, kept_row.url, kept_row.poster_url, kept_row.mime_type,
        kept_row.width, kept_row.height, kept_row.duration_ms, kept_row.size_bytes,
        kept_row.waveform, item_index, kept_row.created_at, kept_row.pop_id
      );
    else
      bars := null;

      if item -> 'waveform' is not null and jsonb_typeof(item -> 'waveform') = 'array' then
        select array_agg(value::smallint order by ord)
        into bars
        from jsonb_array_elements_text(item -> 'waveform') with ordinality as t(value, ord);
      end if;

      insert into public.attachments (
        message_id, message_kind, url, poster_url, mime_type, width, height, duration_ms,
        size_bytes, waveform, position
      ) values (
        m.id,
        new_kind,
        item ->> 'url',
        nullif(item ->> 'poster_url', ''),
        item ->> 'mime_type',
        nullif(item ->> 'width', '')::int,
        nullif(item ->> 'height', '')::int,
        nullif(item ->> 'duration_ms', '')::int,
        nullif(item ->> 'size_bytes', '')::bigint,
        bars,
        item_index
      );
    end if;

    item_index := item_index + 1;
  end loop;

  if old_pops is distinct from (
    select coalesce(array_agg(pop_id order by pop_id) filter (where pop_id is not null), '{}')
    from public.attachments where message_id = m.id
  ) then
    raise exception 'Поп в посте не убрать и не заменить' using errcode = 'check_violation';
  end if;

  if new_kind = 'media' and exists (
    select 1 from public.attachments
    where message_id = m.id
      and pop_id is null
      and (mime_type is null or not (mime_type like 'image/%' or mime_type like 'video/%'))
  ) then
    raise exception 'В альбоме только фото и видео' using errcode = 'check_violation';
  end if;

  perform public.check_message_shape(m.id);

  select id into latest
  from public.messages
  where chat_id = m.chat_id and deleted_at is null
  order by created_at desc
  limit 1;

  if latest = m.id then
    select * into m from public.messages where id = target_message;

    update public.chats
    set last_message_text = public.message_preview_text(m)
    where id = m.chat_id;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object('chat_id', m.chat_id, 'message_id', m.id),
      'message_edited',
      'chat:' || m.chat_id::text,
      true
    );

    if latest = m.id then
      for member in
        select user_id from public.chat_members where chat_id = m.chat_id
      loop
        perform realtime.send(
          jsonb_build_object('chat_id', m.chat_id),
          'chat_changed',
          'user:' || member.user_id::text,
          true
        );
      end loop;

      for member in
        select invitee_id as user_id from public.chat_invites
        where chat_id = m.chat_id and status = 'pending' and invitee_id is not null
      loop
        perform realtime.send(
          jsonb_build_object('chat_id', m.chat_id),
          'invite_activity',
          'user:' || member.user_id::text,
          true
        );
      end loop;
    end if;
  exception
    when others then null;
  end;
end;
$$;
