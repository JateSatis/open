-- Пересылка комментариев в чаты.
--
-- Пересланный комментарий — строка `messages` вида `comment_forward` со
-- ссылкой на сам комментарий (`forwarded_comment_id`). Как островок, он
-- ничего не копирует: правка и удаление оригинала видны в чате сразу, а
-- сниппет сообщения, под которым оставлен комментарий, и чат, откуда он,
-- читаются по ссылкам.
--
-- И как островок, это не самостоятельное сообщение: реакции ставят
-- оригиналу-комментарию, комментировать пересланное нельзя, править тоже.
-- Процитировать его в ответе, закрепить и удалить у всех (переславшему)
-- можно — это действия над строкой чата, а не над комментарием.
--
-- Записать в чат может только участник: функция пересылки проверяет это
-- явно — центральное правило приложения.

-- =============================================================================
-- Вид и ссылка
-- =============================================================================

alter table public.messages
  drop constraint messages_kind_check,
  add constraint messages_kind_check
    check (kind in (
      'text', 'photo', 'video', 'voice', 'video_note', 'system', 'media', 'forward', 'comment_forward'
    )),
  add column forwarded_comment_id uuid,
  -- Комментарии физически не удаляются; связь уходит только вместе с чатом
  -- комментария, и тогда пересланное остаётся заглушкой «Комментарий удалён».
  add constraint messages_forwarded_comment_fkey
    foreign key (forwarded_comment_id) references public.comments (id) on delete set null,
  add constraint messages_forwarded_comment_is_comment_forward
    check (forwarded_comment_id is null or kind = 'comment_forward');

create index messages_forwarded_comment_id_idx
  on public.messages (forwarded_comment_id)
  where forwarded_comment_id is not null;

-- =============================================================================
-- Форма
-- =============================================================================

-- Та же функция, что в 20261002100000_forward_islands.sql, плюс пересланный
-- комментарий: только ссылка — без текста и без файлов.
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

  if m.kind = 'comment_forward' and (
    files > 0 or m.text is not null or m.forwarded_comment_id is null
  ) then
    raise exception 'Пересланный комментарий — только ссылка на комментарий'
      using errcode = 'check_violation';
  end if;
end;
$$;

-- =============================================================================
-- Пересылка
-- =============================================================================

/**
 * Пересылает комментарии в чат, где вызывающий участник: по сообщению на
 * комментарий, одной транзакцией, в переданном порядке — как они стояли в
 * панели. Повторы отсекаются, первое вхождение остаётся. Отдаёт id новых
 * сообщений в том же порядке.
 *
 * Время у сообщений одной пересылки — с шагом в микросекунду: в одной
 * транзакции `now()` одинаков, а порядок в переписке держит время.
 *
 * Security definer: пересланное пишется в обход политики вставки, поэтому
 * участие в целевом чате проверяется здесь явно. Комментарий может быть
 * откуда угодно — переписка и комментарии публичны.
 */
create function public.forward_comments(target_chat uuid, comment_ids uuid[])
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  ids uuid[];
  wanted int;
  found int;
  item record;
  new_id uuid;
  new_ids uuid[] := '{}';
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
    raise exception 'only chat members can forward comments here' using errcode = '42501';
  end if;

  select array_agg(u.id order by u.ord) into ids
  from (
    select distinct on (t.id) t.id, t.ord
    from unnest(comment_ids) with ordinality as t(id, ord)
    where t.id is not null
    order by t.id, t.ord
  ) u;

  wanted := coalesce(cardinality(ids), 0);

  if wanted = 0 then
    raise exception 'nothing to forward' using errcode = '22023';
  end if;

  if wanted > 100 then
    raise exception 'too many comments in one call' using errcode = '22023';
  end if;

  -- for share: удаление комментария (`delete_comment` берёт for update) ждёт,
  -- пока пересылка не ляжет, — удалённое переслать нельзя, даже на гонке.
  perform 1 from public.comments
  where id = any (ids) and deleted_at is null
  for share;

  select count(*) into found
  from public.comments
  where id = any (ids) and deleted_at is null;

  if found <> wanted then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;

  for item in
    select t.id, t.ord from unnest(ids) with ordinality as t(id, ord) order by t.ord
  loop
    insert into public.messages (chat_id, author_id, kind, forwarded_comment_id, created_at)
    values (
      target_chat,
      caller,
      'comment_forward',
      item.id,
      now() + (item.ord - 1) * interval '1 microsecond'
    )
    returning id into new_id;

    new_ids := new_ids || new_id;
  end loop;

  return new_ids;
end;
$$;

revoke execute on function public.forward_comments(uuid, uuid[]) from public, anon;
grant execute on function public.forward_comments(uuid, uuid[]) to authenticated;

-- =============================================================================
-- Превью
-- =============================================================================

-- Та же функция, что в 20261002100000_forward_islands.sql, плюс пересланный
-- комментарий: «💬 » и то, что в нём сказано. Превью — снимок на момент
-- пересылки, как у любого последнего сообщения.
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
-- Пересланный комментарий — не сообщение
-- =============================================================================
--
-- Реакции — у оригинала-комментария, комментарии к пересланному не
-- принимаются, в островок оно не встаёт: это решает база, а не спрятанная
-- кнопка.

-- Та же функция, что в 20261003100000_comment_reactions_and_replies.sql, плюс
-- отказ пересланному комментарию.
create or replace function public.prepare_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target record;
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

  select * into target from public.reaction_target(new.target_type, new.target_id);

  if target.chat_id is null or target.deleted_at is not null then
    raise exception '% not found', new.target_type using errcode = 'P0002';
  end if;

  if target.target_kind = 'forward' then
    raise exception 'forwards take no reactions: react to the originals' using errcode = '22023';
  end if;

  if target.target_kind = 'comment_forward' then
    raise exception 'forwarded comments take no reactions: react to the comment' using errcode = '22023';
  end if;

  new.chat_id := target.chat_id;
  new.updated_at := now();
  new.audience := case
    when exists (
      select 1 from public.chat_members
      where chat_id = target.chat_id and user_id = new.user_id
    ) then 'member'
    else 'visitor'
  end;

  return new;
end;
$$;

-- Та же функция, что в 20261003100000_comment_reactions_and_replies.sql, плюс
-- отказ пересланному комментарию: снятие реакции не проходит через триггер.
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

  if kind = 'message' then
    select m.kind into target_kind from public.messages m
    where m.id = target and m.deleted_at is null
    for no key update;
  elsif kind = 'comment' then
    select 'comment' into target_kind from public.comments c
    where c.id = target and c.deleted_at is null
    for no key update;
  else
    raise exception 'reactions to % are not supported', kind using errcode = '22023';
  end if;

  if not found then
    raise exception '% not found', kind using errcode = 'P0002';
  end if;

  if target_kind = 'forward' then
    raise exception 'forwards take no reactions: react to the originals' using errcode = '22023';
  end if;

  if target_kind = 'comment_forward' then
    raise exception 'forwarded comments take no reactions: react to the comment' using errcode = '22023';
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

-- Та же функция, что в 20261004100000_comment_threads.sql, плюс отказ
-- пересланному комментарию: комментируют оригинал.
create or replace function public.prepare_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.messages;
  root_parent uuid;
begin
  new.created_at := now();
  new.edited_at := null;
  new.deleted_at := null;
  new.replies_count := 0;

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

  if target.kind = 'comment_forward' then
    raise exception 'forwarded comments take no comments' using errcode = '22023';
  end if;

  if new.thread_root_id is not null then
    select thread_root_id into root_parent from public.comments where id = new.thread_root_id;

    if root_parent is not null then
      raise exception 'replies go into the thread of a top-level comment' using errcode = '22023';
    end if;
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

-- Та же функция, что в 20261002100000_forward_islands.sql: в островок встаёт
-- только сообщение человека — не системное, не островок и не пересланный
-- комментарий (его пересылают ссылкой на сам комментарий).
create or replace function public.check_forward_item()
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

  if original_kind in ('system', 'forward', 'comment_forward') then
    raise exception 'only messages can be forwarded' using errcode = '22023';
  end if;

  return new;
end;
$$;
