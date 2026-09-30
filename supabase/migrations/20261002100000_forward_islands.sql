-- Пересылка — островок ссылок на оригиналы.
--
-- До этой миграции пересылка копировала: в целевом чате появлялись новые
-- сообщения от имени переславшего, со своими реакциями и комментариями,
-- начинавшимися с нуля. Разговор, разошедшийся по чатам, рассыпался на
-- независимые копии — реакция в одном месте не была видна в другом.
--
-- Теперь пересылка создаёт в целевом чате одну строку `messages` вида
-- `forward` — островок — и список ссылок на оригиналы (`forward_items`).
-- Островок встаёт в хронологию, постраничную выборку, курсор прочтения и
-- превью списка чатов как обычное сообщение, но сообщением не является: на
-- него нельзя поставить реакцию, его нельзя прокомментировать, процитировать,
-- поправить или переслать. Облачка внутри — сами оригиналы: реакция или
-- комментарий, оставленные в островке, ложатся на оригинал и видны везде,
-- где он показан.
--
-- Заголовок островка — чат, откуда пересылали (`source_chat_id`). Это
-- атрибуция, и подделать её нельзя: позиции пишет только функция пересылки,
-- и она проверяет, что каждое сообщение действительно было в этом чате —
-- своё или в живом островке.

-- =============================================================================
-- Вид `forward` и чат-заголовок
-- =============================================================================

alter table public.messages
  drop constraint messages_kind_check,
  add constraint messages_kind_check
    check (kind in ('text', 'photo', 'video', 'voice', 'video_note', 'system', 'media', 'forward')),
  add column source_chat_id uuid references public.chats (id) on delete set null,
  add constraint messages_source_chat_is_forward check (source_chat_id is null or kind = 'forward');

create index messages_source_chat_id_idx
  on public.messages (source_chat_id)
  where source_chat_id is not null;

-- =============================================================================
-- Позиции островка
-- =============================================================================
--
-- Чат позиции совпадает с чатом островка, а сам островок обязан быть вида
-- `forward` — оба инварианта держат составные внешние ключи, как у вложений
-- и ответов: позицию, приписанную обычному сообщению или чужому чату, база
-- не примет. Порядок — позиция, а не время оригиналов: островок показывает
-- сообщения в том порядке, в каком они стояли на экране исходного чата.
--
-- Позицию можно убрать из островка (мягко, `deleted_at`) — это делает только
-- переславший функцией `remove_forward_items`. Оригинал при этом не трогается.

create table public.forward_items (
  id uuid primary key default gen_random_uuid (),
  chat_id uuid not null references public.chats (id) on delete cascade,
  forward_id uuid not null,
  /** Всегда `forward`: нужен только внешнему ключу на пару (id, kind) островка. */
  forward_kind text not null default 'forward' check (forward_kind = 'forward'),
  /** Оригинал — всегда первоисточник, а не позиция другого островка. */
  message_id uuid not null,
  position int not null check (position >= 0 and position < 100),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint forward_items_forward_fkey
    foreign key (forward_id, chat_id) references public.messages (id, chat_id) on delete cascade,
  constraint forward_items_forward_kind_fkey
    foreign key (forward_id, forward_kind) references public.messages (id, kind) on delete cascade,
  constraint forward_items_message_fkey
    foreign key (message_id) references public.messages (id) on delete cascade,
  constraint forward_items_position_key unique (forward_id, position),
  constraint forward_items_message_key unique (forward_id, message_id)
);

-- «Где показан этот оригинал»: правки, удаления и реакции оригинала находят
-- островки по нему, ответы и закрепы проверяют, что он стоит в чате.
create index forward_items_message_id_idx on public.forward_items (message_id);
create index forward_items_chat_message_idx
  on public.forward_items (chat_id, message_id)
  where deleted_at is null;

alter table public.forward_items enable row level security;

-- Что переслано и откуда — не секрет: переписка публична. Убранная из
-- островка позиция не отдаётся, как и удалённое сообщение.
create policy "forward_items are readable by authenticated users"
  on public.forward_items for select
  to authenticated
  using (deleted_at is null);

-- Политик на запись нет и прав тоже: позиции пишут только функции ниже.
revoke insert, update, delete on public.forward_items from anon, authenticated;

/**
 * Оригинал — сообщение человека: не системное и не другой островок. Ссылка
 * на островок сделала бы цепочку «ссылка на ссылку», которую уже не
 * показать облачком. Позиция не переезжает ни к другому оригиналу, ни в
 * другой островок.
 */
create function public.check_forward_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  original_kind text;
begin
  if tg_op = 'UPDATE' then
    if new.message_id <> old.message_id or new.forward_id <> old.forward_id
       or new.position <> old.position or new.chat_id <> old.chat_id then
      raise exception 'forward items cannot be moved' using errcode = '42501';
    end if;

    return new;
  end if;

  select kind into original_kind from public.messages where id = new.message_id;

  if original_kind in ('system', 'forward') then
    raise exception 'only messages can be forwarded' using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger on_forward_item_written
  before insert or update on public.forward_items
  for each row execute function public.check_forward_item();

revoke execute on function public.check_forward_item() from public, anon, authenticated;

-- =============================================================================
-- Где сообщение показано в чате
-- =============================================================================
--
-- Ответ и закреп могут ссылаться на сообщение, которое в этом чате не живёт,
-- а стоит в островке. Правило одно для обоих: сообщение показано в чате, если
-- оно из этого чата или стоит живой позицией в живом островке этого чата.

/** Самый свежий живой островок чата, где стоит это сообщение; `null` — нигде. */
create function public.forward_holding(target_message uuid, target_chat uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select i.forward_id
  from public.forward_items i
  join public.messages f on f.id = i.forward_id
  where i.message_id = target_message
    and i.chat_id = target_chat
    and i.deleted_at is null
    and f.deleted_at is null
  order by f.created_at desc
  limit 1
$$;

revoke execute on function public.forward_holding(uuid, uuid) from public, anon;
grant execute on function public.forward_holding(uuid, uuid) to authenticated;

/**
 * Сообщение показано в чате: своё (`via` пуст) или живой позицией островка
 * `via` этого чата.
 */
create function public.message_shown_in_chat(target_message uuid, target_chat uuid, via uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when via is null then exists (
      select 1 from public.messages m where m.id = target_message and m.chat_id = target_chat
    )
    else exists (
      select 1
      from public.forward_items i
      join public.messages f on f.id = i.forward_id
      where i.forward_id = via
        and i.chat_id = target_chat
        and i.message_id = target_message
        and i.deleted_at is null
        and f.deleted_at is null
    )
  end
$$;

revoke execute on function public.message_shown_in_chat(uuid, uuid, uuid) from public, anon;
grant execute on function public.message_shown_in_chat(uuid, uuid, uuid) to authenticated;

-- =============================================================================
-- Форма островка
-- =============================================================================
--
-- Островок — не текст и не файлы: без текста, без вложений, с чатом-заголовком
-- и хотя бы одной позицией. Позиции пишет только функция, поэтому островок,
-- вставленный в `messages` прямым запросом, откатывается целиком: заголовок
-- «из <чужого чата>» над пустотой подделать нельзя. Остальное — как в
-- 20260929180000_message_edit.sql.

create or replace function public.check_message_shape(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.messages;
  files int;
begin
  select * into m from public.messages where id = target;

  if m.id is null or m.deleted_at is not null then
    return;
  end if;

  select count(*) into files from public.attachments where message_id = target;

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
end;
$$;

-- =============================================================================
-- Пересылка
-- =============================================================================

drop function public.forward_messages(uuid, uuid[]);

/**
 * Пересылает сообщения в чат, где вызывающий участник: одна строка-островок
 * и позиции в переданном порядке — в том, в каком сообщения стояли на экране
 * исходного чата. Повторы отсекаются, первое вхождение остаётся. Отдаёт id
 * островка.
 *
 * `source_chat` — где человек стоял, когда нажал «Переслать»; это заголовок
 * островка. Каждое сообщение обязано быть в этом чате: своим или живой
 * позицией живого островка. Иначе прямым вызовом можно было бы подписать
 * «из <чужого чата>» что угодно.
 *
 * `message_ids` — всегда оригиналы. Позиция островка пересылается ссылкой на
 * свой оригинал, поэтому цепочки «ссылка на ссылку» не бывает. Сам островок
 * не пересылается: это не сообщение.
 *
 * Security definer, потому что пишет позиции, на которые у клиента прав нет.
 * Поэтому центральное правило — писать только туда, где ты участник, —
 * проверяется здесь явно. Читать источник может кто угодно: посетитель
 * пересылает чужую переписку в свой чат, так она и расходится.
 */
create function public.forward_messages(target_chat uuid, source_chat uuid, message_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  ids uuid[];
  wanted int;
  found int;
  new_forward uuid;
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

  if source_chat is null
     or not exists (select 1 from public.chats where id = source_chat and deleted_at is null) then
    raise exception 'chat not found' using errcode = 'P0002';
  end if;

  select array_agg(u.id order by u.ord) into ids
  from (
    select distinct on (t.id) t.id, t.ord
    from unnest(message_ids) with ordinality as t(id, ord)
    where t.id is not null
    order by t.id, t.ord
  ) u;

  wanted := coalesce(cardinality(ids), 0);

  if wanted = 0 then
    raise exception 'nothing to forward' using errcode = '22023';
  end if;

  if wanted > 100 then
    raise exception 'too many messages in one call' using errcode = '22023';
  end if;

  -- for share: удаление оригинала в параллельной транзакции ждёт, пока
  -- островок не ляжет, — удалённое переслать нельзя, даже на гонке.
  perform 1 from public.messages
  where id = any (ids) and deleted_at is null
  for share;

  select count(*) into found
  from public.messages
  where id = any (ids) and deleted_at is null;

  if found <> wanted then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.messages where id = any (ids) and kind = 'system') then
    raise exception 'system messages cannot be forwarded' using errcode = '22023';
  end if;

  if exists (select 1 from public.messages where id = any (ids) and kind = 'forward') then
    raise exception 'forwards are not messages: forward their originals' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(ids) as t(id)
    where not public.message_shown_in_chat(t.id, source_chat, null)
      and public.forward_holding(t.id, source_chat) is null
  ) then
    raise exception 'messages must come from the source chat' using errcode = '42501';
  end if;

  insert into public.messages (chat_id, author_id, kind, source_chat_id)
  values (target_chat, caller, 'forward', source_chat)
  returning id into new_forward;

  insert into public.forward_items (chat_id, forward_id, message_id, position)
  select target_chat, new_forward, t.id, (t.ord - 1)::int
  from unnest(ids) with ordinality as t(id, ord);

  return new_forward;
end;
$$;

revoke execute on function public.forward_messages(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.forward_messages(uuid, uuid, uuid[]) to authenticated;

/**
 * Переславший убирает сообщения из своего островка — у всех. Оригиналы не
 * трогаются никогда. Убрано последнее — островок удаляется целиком, мягко,
 * как обычное сообщение. Уже убранные в списке не мешают: повтор той же
 * просьбы — не ошибка.
 */
create function public.remove_forward_items(target_forward uuid, message_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  f public.messages;
  latest uuid;
  member record;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into f from public.messages where id = target_forward for update;

  if f.id is null or f.deleted_at is not null or f.kind <> 'forward' then
    raise exception 'forward not found' using errcode = 'P0002';
  end if;

  if f.author_id is distinct from caller then
    raise exception 'only own forwards can be changed' using errcode = '42501';
  end if;

  if coalesce(cardinality(message_ids), 0) = 0 then
    return;
  end if;

  update public.forward_items
  set deleted_at = now()
  where forward_id = f.id and message_id = any (message_ids) and deleted_at is null;

  if not found then
    return;
  end if;

  -- Закреп убранного — только тот, что держался за этот островок.
  update public.message_pins
  set deleted_at = now()
  where chat_id = f.chat_id and forward_id = f.id and message_id = any (message_ids)
    and deleted_at is null;

  if not exists (
    select 1 from public.forward_items where forward_id = f.id and deleted_at is null
  ) then
    -- Дальше — как у любого удалённого сообщения: превью, закрепы, рассылка.
    update public.messages set deleted_at = now() where id = f.id;
    return;
  end if;

  -- Число в превью «Переслано: N сообщений» изменилось, если островок последний.
  select id into latest
  from public.messages
  where chat_id = f.chat_id and deleted_at is null
  order by created_at desc
  limit 1;

  if latest = f.id then
    update public.chats set last_message_text = public.message_preview_text(f) where id = f.chat_id;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object('chat_id', f.chat_id, 'message_id', f.id),
      'forward_changed',
      'chat:' || f.chat_id::text,
      true
    );

    if latest = f.id then
      for member in
        select user_id from public.chat_members where chat_id = f.chat_id
      loop
        perform realtime.send(
          jsonb_build_object('chat_id', f.chat_id),
          'chat_changed',
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

revoke execute on function public.remove_forward_items(uuid, uuid[]) from public, anon;
grant execute on function public.remove_forward_items(uuid, uuid[]) to authenticated;

-- =============================================================================
-- Превью островка
-- =============================================================================

-- Та же функция, что в 20261001100000_calls.sql, плюс «Переслано: N сообщений».
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
-- Островок — не сообщение
-- =============================================================================
--
-- Реакции, комментарии, цитаты и закрепы — у оригиналов внутри. Сам островок
-- их не принимает, и это решает база, а не спрятанная кнопка.

-- Та же функция, что в 20260930100000_reactions.sql, плюс отказ островку.
create or replace function public.prepare_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_chat uuid;
  target_deleted timestamptz;
  target_kind text;
  revived boolean;
begin
  if tg_op = 'UPDATE' then
    if new.target_type is distinct from old.target_type or new.target_id is distinct from old.target_id then
      raise exception 'reaction target cannot change' using errcode = '42501';
    end if;

    revived := old.deleted_at is not null and new.deleted_at is null;

    if new.emoji is not distinct from old.emoji and not revived then
      new.audience := old.audience;
      new.chat_id := old.chat_id;
      return new;
    end if;
  else
    new.deleted_at := null;
    new.created_at := now();
  end if;

  if new.target_type <> 'message' then
    raise exception 'reactions to % are not supported yet', new.target_type
      using errcode = '22023';
  end if;

  select chat_id, deleted_at, kind into target_chat, target_deleted, target_kind
  from public.messages
  where id = new.target_id;

  if target_chat is null or target_deleted is not null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if target_kind = 'forward' then
    raise exception 'forwards take no reactions: react to the originals' using errcode = '22023';
  end if;

  -- Ряд — по чату оригинала: посетитель, поставивший реакцию из островка в
  -- своём чате, остаётся посетителем.
  new.chat_id := target_chat;
  new.updated_at := now();
  new.audience := case
    when exists (
      select 1 from public.chat_members
      where chat_id = target_chat and user_id = new.user_id
    ) then 'member'
    else 'visitor'
  end;

  return new;
end;
$$;

-- Та же функция, что в 20260930100000_reactions.sql, плюс отказ островку:
-- снятие реакции не проходит через триггер вставки.
create or replace function public.set_reaction(target_type text, target_id uuid, reaction text)
returns table (emoji text, audience text)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  kind text := target_type;
  target uuid := target_id;
  target_kind text;
  current_row public.reactions;
  dormant uuid;
  result public.reactions;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if kind <> 'message' then
    raise exception 'reactions to % are not supported yet', kind using errcode = '22023';
  end if;

  select m.kind into target_kind from public.messages m
  where m.id = target and m.deleted_at is null
  for no key update;

  if not found then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if target_kind = 'forward' then
    raise exception 'forwards take no reactions: react to the originals' using errcode = '22023';
  end if;

  select * into current_row
  from public.reactions r
  where r.target_type = kind and r.target_id = target and r.user_id = caller
    and r.deleted_at is null;

  if reaction is null then
    if current_row.id is not null then
      update public.reactions r set deleted_at = now() where r.id = current_row.id;
    end if;

    return;
  end if;

  if current_row.id is not null then
    if current_row.emoji = reaction then
      return query select current_row.emoji, current_row.audience;
      return;
    end if;

    update public.reactions r
    set emoji = reaction
    where r.id = current_row.id
    returning * into result;
  else
    select r.id into dormant
    from public.reactions r
    where r.target_type = kind and r.target_id = target and r.user_id = caller
    order by r.updated_at desc
    limit 1;

    if dormant is not null then
      update public.reactions r
      set emoji = reaction, deleted_at = null
      where r.id = dormant
      returning * into result;
    else
      insert into public.reactions (target_type, target_id, user_id, emoji)
      values (kind, target, caller, reaction)
      returning * into result;
    end if;
  end if;

  return query select result.emoji, result.audience;
end;
$$;

-- Та же функция, что в 20260930180000_comments.sql, плюс отказ островку.
create or replace function public.prepare_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.messages;
begin
  new.created_at := now();
  new.edited_at := null;
  new.deleted_at := null;

  select * into target
  from public.messages
  where id = new.message_id
  for key share;

  if target.id is null or target.deleted_at is not null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if target.kind = 'system' then
    raise exception 'system messages cannot be commented' using errcode = '22023';
  end if;

  if target.kind = 'forward' then
    raise exception 'forwards take no comments: comment on the originals' using errcode = '22023';
  end if;

  new.audience := case
    when exists (
      select 1 from public.chat_members
      where chat_id = target.chat_id and user_id = new.author_id
    ) then 'member'
    else 'visitor'
  end;

  return new;
end;
$$;

-- На системное сообщение и на островок не отвечают: цитировать там нечего.
-- Отвечают на оригиналы внутри островка.
create or replace function public.forbid_reply_to_system()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.messages where id = new.quoted_id and kind = 'system') then
    raise exception 'system messages cannot be quoted' using errcode = '22023';
  end if;

  if exists (select 1 from public.messages where id = new.quoted_id and kind = 'forward') then
    raise exception 'forwards cannot be quoted: quote the originals' using errcode = '22023';
  end if;

  return new;
end;
$$;

-- =============================================================================
-- Ответ на сообщение из островка
-- =============================================================================
--
-- Цитата ссылается на оригинал, даже если он из другого чата, — когда он
-- стоит в живом островке этого чата. Какой островок держит цитату, помнит
-- `quoted_forward_id`: по нему облачко ответа прыгает к оригиналу внутри
-- островка. Раньше «только тот же чат» держал составной внешний ключ; теперь
-- правило шире, и его держит триггер.

alter table public.message_replies
  drop constraint message_replies_quoted_fkey,
  add constraint message_replies_quoted_fkey
    foreign key (quoted_id) references public.messages (id) on delete cascade,
  add column quoted_forward_id uuid,
  add constraint message_replies_quoted_forward_fkey
    foreign key (quoted_forward_id, chat_id) references public.messages (id, chat_id) on delete cascade;

create index message_replies_quoted_forward_id_idx
  on public.message_replies (quoted_forward_id)
  where quoted_forward_id is not null;

/** Цитата — из этого чата или из живого островка этого чата. */
create function public.check_reply_quote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.message_shown_in_chat(new.quoted_id, new.chat_id, new.quoted_forward_id) then
    raise exception 'quoted message is not shown in this chat' using errcode = '23503';
  end if;

  return new;
end;
$$;

create trigger on_reply_quote_written
  before insert on public.message_replies
  for each row execute function public.check_reply_quote();

revoke execute on function public.check_reply_quote() from public, anon, authenticated;

-- Как прежде, но чат цитаты проверяет триггер выше: здесь — только что
-- цитата жива (подзапрос идёт под политикой `messages`).
drop policy "message_replies are attached by the author when sending" on public.message_replies;

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
    )
  );

/**
 * Цитаты нового сообщения — по порядку. Цитата из другого чата принимается,
 * если оригинал стоит в живом островке этого чата; островок база находит
 * сама — самый свежий.
 */
create or replace function public.add_message_replies(new_message uuid, target_chat uuid, reply_to uuid[])
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

  -- Понятная ошибка раньше, чем сработает политика или триггер: цитата не из
  -- этого чата или удалённое сообщение (его не видно по SELECT-политике).
  if (
    select count(*) from public.messages q
    where q.id = any (reply_to)
      and (q.chat_id = target_chat or public.forward_holding(q.id, target_chat) is not null)
  ) <> wanted then
    raise exception 'quoted message not found' using errcode = 'P0002';
  end if;

  insert into public.message_replies (chat_id, message_id, quoted_id, position, quoted_forward_id)
  select
    target_chat,
    new_message,
    quoted.id,
    (quoted.ord - 1)::int,
    case
      when exists (select 1 from public.messages q where q.id = quoted.id and q.chat_id = target_chat)
        then null
      else public.forward_holding(quoted.id, target_chat)
    end
  from unnest(reply_to) with ordinality as quoted(id, ord);
end;
$$;

-- =============================================================================
-- Закреп сообщения из островка
-- =============================================================================
--
-- Закрепить можно и отдельное облачко островка: закреп ссылается на оригинал
-- и помнит островок, за который держится (`forward_id`). Одно сообщение
-- закрепляется в чате один раз — раньше «один раз» было глобальным, теперь
-- тот же оригинал можно закрепить и у себя, и в чате, куда его переслали.

alter table public.message_pins
  drop constraint message_pins_message_id_chat_id_fkey,
  add constraint message_pins_message_fkey
    foreign key (message_id) references public.messages (id) on delete cascade,
  add column forward_id uuid,
  add constraint message_pins_forward_fkey
    foreign key (forward_id, chat_id) references public.messages (id, chat_id) on delete cascade;

drop index public.message_pins_active_message_key;

create unique index message_pins_active_message_key
  on public.message_pins (chat_id, message_id)
  where deleted_at is null;

create index message_pins_message_id_idx on public.message_pins (message_id);
create index message_pins_forward_id_idx
  on public.message_pins (forward_id)
  where forward_id is not null;

/** Закреплено то, что показано в чате: своё сообщение или живая позиция его островка. */
create function public.check_pin_target()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.message_shown_in_chat(new.message_id, new.chat_id, new.forward_id) then
    raise exception 'pinned message is not shown in this chat' using errcode = '23503';
  end if;

  if exists (select 1 from public.messages where id = new.message_id and kind = 'forward') then
    raise exception 'forwards cannot be pinned: pin the originals' using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger on_pin_written
  before insert on public.message_pins
  for each row execute function public.check_pin_target();

revoke execute on function public.check_pin_target() from public, anon, authenticated;

drop policy "message_pins can be added by chat members" on public.message_pins;

create policy "message_pins can be added by chat members"
  on public.message_pins for insert
  to authenticated
  with check (
    auth.uid() = pinned_by
    and exists (
      select 1 from public.chat_members
      where chat_members.chat_id = message_pins.chat_id
        and chat_members.user_id = auth.uid()
    )
    and exists (
      select 1 from public.messages
      where messages.id = message_pins.message_id
    )
  );

drop function public.pin_message(uuid);

/**
 * Закрепляет сообщение в чате. `in_forward` — островок, внутри которого
 * стоит закрепляемое: тогда закреп ложится в чат островка, а сообщение —
 * оригинал из другого чата.
 */
create function public.pin_message(target_message uuid, in_forward uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  target_chat uuid;
  target_kind text;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- for share: удаление того же сообщения в параллельной транзакции ждёт,
  -- пока закреп не ляжет, и затем снимает его вместе с сообщением.
  select chat_id, kind into target_chat, target_kind
  from public.messages
  where id = target_message and deleted_at is null
  for share;

  if target_chat is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if target_kind = 'forward' then
    raise exception 'forwards cannot be pinned: pin the originals' using errcode = '22023';
  end if;

  if in_forward is not null then
    select chat_id into target_chat
    from public.messages
    where id = in_forward and kind = 'forward' and deleted_at is null
    for share;

    if target_chat is null
       or not public.message_shown_in_chat(target_message, target_chat, in_forward) then
      raise exception 'message not found' using errcode = 'P0002';
    end if;
  end if;

  if not exists (
    select 1 from public.chat_members
    where chat_id = target_chat and user_id = caller
  ) then
    raise exception 'only chat members can pin messages' using errcode = '42501';
  end if;

  insert into public.message_pins (chat_id, message_id, pinned_by, forward_id)
  values (target_chat, target_message, caller, in_forward)
  on conflict (chat_id, message_id) where deleted_at is null do nothing;
end;
$$;

revoke execute on function public.pin_message(uuid, uuid) from public, anon;
grant execute on function public.pin_message(uuid, uuid) to authenticated;

drop function public.unpin_message(uuid);

/** Открепляет сообщение в чате `target_chat`; без него — в чате самого сообщения. */
create function public.unpin_message(target_message uuid, target_chat uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  chat uuid := target_chat;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if chat is null then
    select chat_id into chat from public.messages where id = target_message;
  end if;

  if chat is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.chat_members
    where chat_id = chat and user_id = caller
  ) then
    raise exception 'only chat members can unpin messages' using errcode = '42501';
  end if;

  update public.message_pins
  set deleted_at = now()
  where chat_id = chat and message_id = target_message and deleted_at is null;
end;
$$;

revoke execute on function public.unpin_message(uuid, uuid) from public, anon;
grant execute on function public.unpin_message(uuid, uuid) to authenticated;

/**
 * Та же функция, что в 20260927100000_message_delete_and_pins.sql, плюс
 * закрепы, державшиеся за удалённый островок.
 */
create or replace function public.handle_messages_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected record;
  last_live public.messages;
  preview_changed boolean;
  member record;
begin
  for affected in
    select n.chat_id, array_agg(n.id) as ids, max(n.created_at) as newest
    from new_rows n
    join old_rows o on o.id = n.id
    where o.deleted_at is null and n.deleted_at is not null
    group by n.chat_id
  loop
    update public.message_pins
    set deleted_at = now()
    where (message_id = any (affected.ids) or forward_id = any (affected.ids))
      and deleted_at is null;

    select coalesce(last_message_at <= affected.newest, false) into preview_changed
    from public.chats
    where id = affected.chat_id;

    if preview_changed then
      select * into last_live
      from public.messages
      where chat_id = affected.chat_id and deleted_at is null
      order by created_at desc
      limit 1;

      update public.chats
      set
        last_message_at = last_live.created_at,
        last_message_text = case
          when last_live.id is null then null
          else public.message_preview_text(last_live)
        end,
        last_message_author_id = last_live.author_id
      where id = affected.chat_id;
    end if;

    begin
      perform realtime.send(
        jsonb_build_object('chat_id', affected.chat_id, 'message_ids', to_jsonb(affected.ids)),
        'messages_deleted',
        'chat:' || affected.chat_id::text,
        true
      );

      if preview_changed then
        for member in
          select user_id from public.chat_members where chat_id = affected.chat_id
        loop
          perform realtime.send(
            jsonb_build_object('chat_id', affected.chat_id),
            'chat_changed',
            'user:' || member.user_id::text,
            true
          );
        end loop;

        for member in
          select invitee_id as user_id from public.chat_invites
          where chat_id = affected.chat_id and status = 'pending' and invitee_id is not null
        loop
          perform realtime.send(
            jsonb_build_object('chat_id', affected.chat_id),
            'invite_activity',
            'user:' || member.user_id::text,
            true
          );
        end loop;
      end if;
    exception
      when others then null;
    end;
  end loop;

  return null;
end;
$$;

-- =============================================================================
-- Чат оригинала глазами смотрящего
-- =============================================================================
--
-- Облачко островка подписано «<автор> из <чат>», ряд реакций в нём — по
-- участию в чате оригинала, «прочитано» у своего — по прочтению того чата.
-- Всё это приходит той же выборкой, что и переписка: вычисляемыми полями
-- чата, без отдельного запроса на каждый островок.

/**
 * Название чата для чужих глаз: заданное, а без него — люди. У личного
 * диалога — остальные участники, кроме смотрящего: самому себе он «Марина»,
 * постороннему — «Марина и Пётр».
 */
create function public.chat_display_name(public.chats)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    nullif(btrim($1.title), ''),
    (
      select string_agg(coalesce(p.display_name, 'Без имени'), case when $1.kind = 'direct' then ' и ' else ', ' end order by m.joined_at)
      from (
        select cm.user_id, cm.joined_at
        from public.chat_members cm
        where cm.chat_id = $1.id and cm.user_id is distinct from auth.uid()
        order by cm.joined_at
        limit 3
      ) m
      join public.profiles p on p.id = m.user_id
    ),
    case when $1.kind = 'group' then 'Групповой чат' else 'Диалог' end
  )
$$;

/** До какого момента чат прочитали все, кроме смотрящего. `null` — читать некому. */
create function public.chat_read_up_to(public.chats)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select min(cm.last_read_at)
  from public.chat_members cm
  where cm.chat_id = $1.id and cm.user_id is distinct from auth.uid()
$$;

/** Смотрящий — участник этого чата. */
create function public.chat_am_member(public.chats)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.chat_members cm
    where cm.chat_id = $1.id and cm.user_id = auth.uid()
  )
$$;

revoke execute on function public.chat_display_name(public.chats) from public, anon;
revoke execute on function public.chat_read_up_to(public.chats) from public, anon;
revoke execute on function public.chat_am_member(public.chats) from public, anon;
grant execute on function public.chat_display_name(public.chats) to authenticated;
grant execute on function public.chat_read_up_to(public.chats) to authenticated;
grant execute on function public.chat_am_member(public.chats) to authenticated;

-- =============================================================================
-- Правка: без запрета пересланному
-- =============================================================================
--
-- Копий больше нет — правка оригинала сразу видна во всех островках. Та же
-- функция, что в 20260929180000_message_edit.sql, без отказа пересланным.
-- Островок она и так не правит: вид `forward` не текст, не альбом и не
-- голосовое.

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

  select coalesce(array_agg(url order by position), '{}') into old_urls
  from public.attachments where message_id = m.id;

  select coalesce(
    array_agg(
      coalesce(
        (select a.url from public.attachments a
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
        size_bytes, waveform, position, created_at
      ) values (
        kept_row.id, m.id, new_kind, kept_row.url, kept_row.poster_url, kept_row.mime_type,
        kept_row.width, kept_row.height, kept_row.duration_ms, kept_row.size_bytes,
        kept_row.waveform, item_index, kept_row.created_at
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

  if new_kind = 'media' and exists (
    select 1 from public.attachments
    where message_id = m.id
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

-- =============================================================================
-- Старые копии → островки
-- =============================================================================
--
-- Копии одной пересылки лежат подряд в одном чате, от одного автора, с
-- временем в пределах одной транзакции — из них получается один островок.
-- Заголовок — чат первого оригинала: откуда на самом деле пересылали, старая
-- модель не хранила. Оригинал, которого уже нет, становится в островке
-- заглушкой «Сообщение удалено».
--
-- Копии не стираются: они получают `deleted_at`, а связь «копия → позиция
-- островка» остаётся в `legacy_forward_copies` для модерации. Своих реакций
-- и комментариев у островка нет — у перенесённой копии они остаются в базе,
-- но в интерфейсе больше не видны (показываются реакции оригинала).
--
-- Рассылки и пересчёт превью на время переноса выключены: островки получают
-- время своих копий, и обычный триггер записал бы в превью чата старое
-- сообщение поверх нового. Превью пересчитывается в конце.

create table public.legacy_forward_copies (
  id uuid primary key default gen_random_uuid (),
  copy_id uuid not null references public.messages (id) on delete cascade,
  forward_item_id uuid references public.forward_items (id) on delete set null,
  /** Почему копия не стала позицией. `null` — перенесена. */
  note text,
  created_at timestamptz not null default now()
);

create index legacy_forward_copies_copy_id_idx on public.legacy_forward_copies (copy_id);
create index legacy_forward_copies_forward_item_id_idx on public.legacy_forward_copies (forward_item_id);

alter table public.legacy_forward_copies enable row level security;

-- Только для модерации: политик нет, права отозваны, читает сервисная роль.
revoke all on public.legacy_forward_copies from anon, authenticated;

alter table public.messages disable trigger on_message_created;
alter table public.messages disable trigger on_messages_deleted;
alter table public.messages disable trigger on_message_changed_for_comments;

do $$
declare
  grp record;
  cp record;
  new_forward uuid;
  pos int;
  item uuid;
  affected uuid[] := '{}';
begin
  for grp in
    with timeline as (
      select
        m.id,
        m.chat_id,
        m.author_id,
        m.created_at,
        f.origin_message_id,
        f.id is not null as is_copy,
        lag(f.id is not null) over w as prev_is_copy,
        lag(m.author_id) over w as prev_author,
        lag(m.created_at) over w as prev_at
      from public.messages m
      left join public.message_forwards f on f.message_id = m.id
      where m.deleted_at is null
        and m.chat_id in (
          select c.chat_id from public.messages c join public.message_forwards cf on cf.message_id = c.id
        )
      window w as (partition by m.chat_id order by m.created_at, m.id)
    ),
    starts as (
      select
        t.*,
        (
          not coalesce(t.prev_is_copy, false)
          or t.prev_author is distinct from t.author_id
          or t.created_at - t.prev_at > interval '2 seconds'
        ) as starts_group
      from timeline t
      where t.is_copy
    ),
    numbered as (
      select s.*, sum(s.starts_group::int) over (partition by s.chat_id order by s.created_at, s.id) as grp
      from starts s
    )
    select
      n.chat_id,
      n.grp,
      (array_agg(n.author_id))[1] as author_id,
      min(n.created_at) as created_at,
      array_agg(n.id order by n.created_at, n.id) as copy_ids
    from numbered n
    group by n.chat_id, n.grp
    order by n.chat_id, n.grp
  loop
    new_forward := null;
    pos := 0;

    for cp in
      select m.id, f.origin_message_id, o.chat_id as origin_chat, o.kind as origin_kind
      from unnest(grp.copy_ids) with ordinality as c(id, ord)
      join public.messages m on m.id = c.id
      join public.message_forwards f on f.message_id = m.id
      left join public.messages o on o.id = f.origin_message_id
      order by c.ord
    loop
      if cp.origin_message_id is null or cp.origin_chat is null then
        insert into public.legacy_forward_copies (copy_id, note)
        values (cp.id, 'оригинал не сохранился — копия оставлена как есть');
        continue;
      end if;

      if cp.origin_kind in ('system', 'forward') then
        insert into public.legacy_forward_copies (copy_id, note)
        values (cp.id, 'оригинал не сообщение — копия оставлена как есть');
        continue;
      end if;

      if new_forward is null then
        insert into public.messages (chat_id, author_id, kind, source_chat_id, created_at)
        values (grp.chat_id, grp.author_id, 'forward', cp.origin_chat, grp.created_at)
        returning id into new_forward;

        affected := affected || grp.chat_id;
      end if;

      select i.id into item
      from public.forward_items i
      where i.forward_id = new_forward and i.message_id = cp.origin_message_id;

      if item is null then
        insert into public.forward_items (chat_id, forward_id, message_id, position, created_at)
        values (grp.chat_id, new_forward, cp.origin_message_id, pos, grp.created_at)
        returning id into item;

        pos := pos + 1;
      end if;

      -- Повтор того же оригинала в одной пересылке — одна позиция на оба.
      insert into public.legacy_forward_copies (copy_id, forward_item_id)
      values (cp.id, item);

      -- Ответы на копию цитируют теперь оригинал в островке.
      update public.message_replies r
      set quoted_id = cp.origin_message_id, quoted_forward_id = new_forward
      where r.quoted_id = cp.id
        and not exists (
          select 1 from public.message_replies d
          where d.message_id = r.message_id and d.quoted_id = cp.origin_message_id
        );

      -- Закреп копии держится теперь за оригинал в островке.
      update public.message_pins p
      set message_id = cp.origin_message_id, forward_id = new_forward
      where p.message_id = cp.id
        and p.deleted_at is null
        and not exists (
          select 1 from public.message_pins d
          where d.chat_id = p.chat_id and d.message_id = cp.origin_message_id
            and d.deleted_at is null
        );

      update public.message_pins set deleted_at = now()
      where message_id = cp.id and deleted_at is null;

      update public.messages set deleted_at = now() where id = cp.id;
    end loop;
  end loop;

  -- Превью затронутых чатов — по последнему живому сообщению.
  update public.chats c
  set
    last_message_at = l.created_at,
    last_message_text = l.preview,
    last_message_author_id = l.author_id
  from (
    select distinct on (m.chat_id)
      m.chat_id, m.created_at, m.author_id, public.message_preview_text(m) as preview
    from public.messages m
    where m.deleted_at is null and m.chat_id = any (affected)
    order by m.chat_id, m.created_at desc
  ) l
  where c.id = l.chat_id;
end;
$$;

-- Отложенные проверки формы перенесённых островков — сейчас: пока они
-- ждут конца транзакции, таблицу не изменить.
set constraints all immediate;
set constraints all deferred;

alter table public.messages enable trigger on_message_created;
alter table public.messages enable trigger on_messages_deleted;
alter table public.messages enable trigger on_message_changed_for_comments;

-- =============================================================================
-- Старая модель копий уходит
-- =============================================================================

drop trigger on_attachment_added_to_forward on public.attachments;
drop trigger on_forwarded_text_changed on public.messages;
drop function public.protect_forwarded_content();
drop table public.message_forwards;
