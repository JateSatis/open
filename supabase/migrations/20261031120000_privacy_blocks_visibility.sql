-- Приватность, этап 3: видимость заявок и блокировок, проверки в действиях.
--
-- Непринятая заявка на диалог видна только двоим: чат, его сообщения,
-- «ещё не принял», участники, топик `chat:<id>`, подписка, пересылка из него
-- и реакции с комментариями к нему — всё отказывает постороннему так, будто
-- чата нет.
--
-- Блокировка (в любую сторону, с аккаунтами устройства заблокированного):
--   * сообщения заблокировавшего в чатах, где заблокированный не участник, —
--     заглушка: строка в `message_rows` остаётся (номер `seq`, цитаты и
--     страницы не ломаются), но без текста, вложений, реакций и счётчиков, с
--     признаком `hidden`; прямой запрос к `messages` её не отдаёт, вложения —
--     тоже. В общих чатах сообщения видны: иначе чат не читается;
--   * комментарии и реакции пары друг другу не показываются (и в списках
--     реагировавших); счётчики — агрегаты, их не пересчитываем;
--   * комментировать и реагировать на сообщения и комментарии другого нельзя
--     (OPN08) — осознанное исключение из правила «комментарии и реакции
--     нельзя запретить»: блокировка прекращает контакт. Посты и попсы канала
--     — контент канала, не человека, к ним это не относится;
--   * профиль заблокировавшего заблокированному не читается, в поиске людей
--     и среди знакомых его нет;
--   * пригласить в группу и отправить заявку в друзья нельзя (OPN08).
--
-- Автоограничение (OPN11): заявки в друзья, приглашения в группы не-друзьям
-- и поиск людей вне знакомых.

-- =============================================================================
-- Чат видят только двое, пока заявка не принята
-- =============================================================================

drop policy "chats are readable by authenticated users" on public.chats;

create policy "chats are readable by authenticated users"
  on public.chats for select
  to authenticated
  using (
    deleted_at is null
    and (not request_pending or (select auth.uid()) = any (founding_member_ids))
  );

/** Чат существует и виден мне: заявку видят только двое. */
create function public.chat_readable(p_chat uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chats c
    where c.id = p_chat
      and c.deleted_at is null
      and (not c.request_pending or auth.uid() = any (c.founding_member_ids))
  )
$$;

/**
 * Сообщение заблокировавшего видно смотрящему: он участник этого чата (общий
 * чат) или это пост канала.
 */
create function public.blocker_message_visible(p_chat uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.chats where id = p_chat and kind = 'channel_posts')
    or exists (select 1 from public.chat_members where chat_id = p_chat and user_id = auth.uid())
$$;

drop policy "messages are readable by authenticated users" on public.messages;

create policy "messages are readable by authenticated users"
  on public.messages for select
  to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and (not c.request_pending or (select auth.uid()) = any (c.founding_member_ids))
    )
    and case
      when author_id = any ((select public.my_blockers())::uuid[]) and kind <> 'system'
        then public.blocker_message_visible(chat_id)
      else true
    end
  );

-- Права владельца: RLS таблиц представление обходит, поэтому условия
-- политики `messages` повторены здесь. Заглушка — вместо пропуска строки.
create or replace view public.message_rows as
select
  m.id,
  m.chat_id,
  m.author_id,
  case when h.hidden then 'text' else m.kind end as kind,
  case when h.hidden then null else m.text end as text,
  m.seq,
  case when t.visible then m.created_at end as created_at,
  case when t.visible and not h.hidden then m.edited_at end as edited_at,
  m.edited_at is not null and not h.hidden as edited,
  case when m.edited_at is not null and not h.hidden then public.message_edit_count(m.id) end as edit_mark,
  case when t.reads then m.read_at end as read_at,
  m.deleted_at,
  case when h.hidden then '{}'::jsonb else m.member_reactions end as member_reactions,
  case when h.hidden then '{}'::jsonb else m.visitor_reactions end as visitor_reactions,
  case when h.hidden then 0 else m.reactions_count end as reactions_count,
  case when h.hidden then 0 else m.comments_count end as comments_count,
  case when h.hidden then 0 else m.clusters_count end as clusters_count,
  case when h.hidden then 0 else m.fragments_count end as fragments_count,
  case when h.hidden then 0 when t.reads then m.views_count
    else greatest(m.views_count - m.member_views_count, 0) end as views_count,
  case when h.hidden then 0 when t.reads then m.unique_views_count
    else greatest(m.unique_views_count - m.member_unique_views_count, 0) end as unique_views_count,
  case when h.hidden then null else m.stream_id end as stream_id,
  m.system_event,
  m.system_user_id,
  case when h.hidden then null else m.source_chat_id end as source_chat_id,
  case when h.hidden then null else m.forwarded_comment_id end as forwarded_comment_id,
  t.visible as time_visible,
  t.reads as reads_visible,
  h.hidden
from public.messages m
join public.chats c on c.id = m.chat_id
cross join (select public.my_blockers() as ids) blockers
cross join lateral public.chat_visibility(m.chat_id) t
cross join lateral (
  select case
    when m.author_id = any (blockers.ids) and m.kind <> 'system' and c.kind <> 'channel_posts'
      then not exists (
        select 1 from public.chat_members cm
        where cm.chat_id = m.chat_id and cm.user_id = auth.uid()
      )
    else false
  end as hidden
) h
where m.deleted_at is null
  and (not c.request_pending or auth.uid() = any (c.founding_member_ids));

-- «Ещё не принял» — представление с правами владельца: заявку на диалог
-- посторонний не увидит и здесь.
create or replace view public.chat_waiting_invitees as
select
  i.chat_id,
  i.invitee_id as user_id,
  i.created_at as invited_at,
  p.display_name,
  p.avatar_url,
  p.username
from public.chat_invites i
join public.profiles p on p.id = i.invitee_id and p.deleted_at is null
where i.status <> 'accepted'
  and exists (
    select 1 from public.chats c
    where c.id = i.chat_id
      and (not c.request_pending or auth.uid() = any (c.founding_member_ids))
  );

create or replace function public.chat_people(chat_ids uuid[])
returns table (
  chat_id uuid,
  user_id uuid,
  display_name text,
  avatar_url text,
  username text,
  last_read_at timestamptz,
  joined_at timestamptz,
  "position" int
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if coalesce(cardinality(chat_ids), 0) > 500 then
    raise exception 'Слишком много чатов за раз' using errcode = '22023';
  end if;

  return query
  with shown as (
    select c.id, v.visible, v.reads
    from public.chats c
    cross join lateral public.chat_visibility(c.id) v
    where c.id = any (chat_ids)
      and c.deleted_at is null
      and (not c.request_pending or auth.uid() = any (c.founding_member_ids))
  )
  select
    cm.chat_id,
    cm.user_id,
    p.display_name,
    p.avatar_url,
    p.username,
    case when s.reads then cm.last_read_at end,
    case when s.visible then cm.joined_at end,
    (row_number() over (partition by cm.chat_id order by cm.joined_at, cm.user_id) - 1)::int
  from public.chat_members cm
  join shown s on s.id = cm.chat_id
  left join public.profiles p on p.id = cm.user_id
  order by cm.chat_id, cm.joined_at, cm.user_id;
end;
$$;

-- Топик чата: заявку слушают только двое.
create function public.realtime_chat_readable(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  if p_topic is null or left(p_topic, 5) <> 'chat:' then
    return false;
  end if;

  begin
    target := substr(p_topic, 6)::uuid;
  exception
    when invalid_text_representation then
      return false;
  end;

  return not exists (
    select 1 from public.chats c
    where c.id = target
      and c.request_pending
      and not (auth.uid() = any (c.founding_member_ids))
  );
end;
$$;

drop policy "chat and own user broadcasts are readable" on realtime.messages;

create policy "chat and own user broadcasts are readable"
  on realtime.messages for select
  to authenticated
  using (
    (realtime.topic() like 'chat:%' and public.realtime_chat_readable(realtime.topic()))
    or realtime.topic() = 'user:' || (select auth.uid())::text
  );

create or replace function public.subscribe_to_chat(target_chat uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if not exists (select 1 from public.profiles where id = me and deleted_at is null) then
    raise exception 'Профиль удалён' using errcode = '42501';
  end if;

  if not public.chat_readable(target_chat) then
    raise exception 'Чат не найден' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.chat_members where chat_id = target_chat and user_id = me) then
    raise exception 'На свой чат не подписываются' using errcode = '42501';
  end if;

  -- Чат постов канала отвергает триггер `subscriptions_guard_chat`.
  insert into public.subscriptions (subscriber_id, chat_id, in_chats)
  values (me, target_chat, true)
  on conflict (subscriber_id, chat_id) where chat_id is not null do nothing;
end;
$$;

-- Пересылка: из невидимой мне заявки и скрытые от меня сообщения
-- заблокировавшего — нельзя (заглушку видно, а содержимое уехало бы в мой чат).
create or replace function public.forward_messages(target_chat uuid, source_chat uuid, message_ids uuid[])
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

  if source_chat is null or not public.chat_readable(source_chat) then
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
    select 1 from public.messages m
    where m.id = any (ids)
      and m.author_id = any (public.my_blockers())
      and not public.blocker_message_visible(m.chat_id)
  ) then
    raise exception 'message not found' using errcode = 'P0002';
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

-- =============================================================================
-- Превью и рассылки нового сообщения
-- =============================================================================
--
-- Превью последнего сообщения денормализовано в `chats.last_message_text` и
-- одно на всех. Колонку не закрыть: вычисляемые поля `chats` требуют права
-- на все её колонки. Клиент читает превью через `last_message_preview` —
-- с заглушкой для сообщения заблокировавшего в чужом смотрящему чате.

/** Заблокировал ли `p_author` смотрящего `p_viewer` (или аккаунт его устройства). */
create function public.is_blocked_by(p_viewer uuid, p_author uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_viewer is not null and p_author is not null and exists (
    select 1 from public.blocks b
    where b.blocker_id = p_author
      and b.blocked_id in (select public.linked_accounts(p_viewer))
  )
$$;

create function public.last_message_preview(public.chats)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when $1.last_message_author_id = any (public.my_blockers())
      and $1.kind <> 'channel_posts'
      and not exists (
        select 1 from public.chat_members cm
        where cm.chat_id = $1.id and cm.user_id = auth.uid()
      )
      then 'Сообщение скрыто'
    else $1.last_message_text
  end
$$;

create or replace function public.broadcast_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
  member record;
  author_name text;
  preview_text text;
  posts_channel public.channels;
  outsider_title text;
begin
  preview_text := public.message_preview_text(new);

  update public.chats
  set
    last_message_text = preview_text,
    last_message_author_id = new.author_id
  where id = new.chat_id;

  select display_name into author_name from public.profiles where id = new.author_id;
  select * into posts_channel from public.channels where posts_chat_id = new.chat_id;

  -- Без времени: оно бывает скрыто от части слушателей, а строку клиент
  -- всё равно перечитывает из базы.
  payload := jsonb_build_object(
    'message_id', new.id,
    'chat_id', new.chat_id,
    'author_id', new.author_id,
    'author_name', author_name,
    'kind', new.kind,
    'text', preview_text
  );

  -- Пост подписан каналом, а не человеком, который его опубликовал.
  if posts_channel.id is not null then
    payload := payload || jsonb_build_object(
      'channel_id', posts_channel.id,
      'channel_title', posts_channel.title,
      'channel_avatar_url', posts_channel.avatar_url
    );
  end if;

  begin
    -- Топик чата слушает кто угодно, а клиенту он лишь сигнал «перечитай»:
    -- текста и имени в нём нет — сообщение заблокировавшего не утечёт тому,
    -- от кого оно скрыто.
    perform realtime.send(
      jsonb_build_object(
        'message_id', new.id,
        'chat_id', new.chat_id,
        'author_id', new.author_id,
        'kind', new.kind
      ),
      'new_message',
      'chat:' || new.chat_id::text,
      true
    );

    for member in
      select user_id from public.chat_members
      where chat_id = new.chat_id and user_id is distinct from new.author_id
    loop
      perform realtime.send(payload, 'new_message', 'user:' || member.user_id::text, true);
    end loop;

    if posts_channel.id is not null then
      for member in
        select subscriber_id, notify from public.subscriptions
        where channel_id = posts_channel.id and in_chats
          and subscriber_id is distinct from new.author_id
      loop
        perform realtime.send(
          payload || jsonb_build_object('notify', member.notify),
          'new_message',
          'user:' || member.subscriber_id::text,
          true
        );
      end loop;
    elsif exists (select 1 from public.subscriptions where chat_id = new.chat_id) then
      outsider_title := public.outsider_chat_title(new.chat_id);

      for member in
        select subscriber_id, notify from public.subscriptions
        where chat_id = new.chat_id
      loop
        -- Подписчику, которого автор заблокировал, — только сигнал, без
        -- текста и без уведомления.
        if public.is_blocked_by(member.subscriber_id, new.author_id) then
          perform realtime.send(
            (payload - 'text' - 'author_name') || jsonb_build_object('notify', false, 'chat_title', outsider_title),
            'new_message',
            'user:' || member.subscriber_id::text,
            true
          );
        else
          perform realtime.send(
            payload || jsonb_build_object('notify', member.notify, 'chat_title', outsider_title),
            'new_message',
            'user:' || member.subscriber_id::text,
            true
          );
        end if;
      end loop;
    end if;

    for member in
      select invitee_id as user_id from public.chat_invites
      where chat_id = new.chat_id and status = 'pending' and invitee_id is not null
    loop
      perform realtime.send(
        jsonb_build_object('chat_id', new.chat_id),
        'invite_activity',
        'user:' || member.user_id::text,
        true
      );
    end loop;
  exception
    when others then null;
  end;

  return new;
end;
$$;

-- =============================================================================
-- Профиль заблокировавшего заблокированному не читается
-- =============================================================================

drop policy "profiles are readable by authenticated users" on public.profiles;

create policy "profiles are readable by authenticated users"
  on public.profiles for select
  to authenticated
  using (deleted_at is null and id <> all ((select public.my_blockers())::uuid[]));

-- =============================================================================
-- Комментарии и реакции пары друг другу не показываются
-- =============================================================================

drop policy "comments are readable by authenticated users" on public.comments;

create policy "comments are readable by authenticated users"
  on public.comments for select
  to authenticated
  using (
    deleted_at is null
    and (author_id is null or author_id <> all ((select public.my_block_peers())::uuid[]))
  );

drop policy "reactions are readable by authenticated users" on public.reactions;

create policy "reactions are readable by authenticated users"
  on public.reactions for select
  to authenticated
  using (
    deleted_at is null
    and (user_id is null or user_id <> all ((select public.my_block_peers())::uuid[]))
  );

create or replace function public.list_comment_thread_roots(
  target uuid,
  after_rank double precision default null,
  after_id uuid default null,
  page_size int default 30,
  fragment uuid default null,
  cluster uuid default null,
  area_start int default null,
  area_end int default null
)
returns setof public.comments
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.comments;
  fragments uuid[];
  peers uuid[] := public.my_block_peers();
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  fragments := public.fragment_set_ids(target, fragment, cluster, area_start, area_end);

  for c in
    select *
    from public.comments
    where target_id = target
      and thread_root_id is null
      and (fragments is null or fragment_id = any (fragments))
      and (deleted_at is null or replies_count > 0)
      and (author_id is null or author_id <> all (peers))
      and (after_rank is null or (rank, id) < (after_rank, after_id))
    order by rank desc, id desc
    limit least(greatest(coalesce(page_size, 30), 1), 100)
  loop
    if c.deleted_at is not null then
      c.author_id := null;
      c.text := null;
      c.edited_at := null;
      c.member_reactions := '{}'::jsonb;
      c.visitor_reactions := '{}'::jsonb;
      c.reactions_count := 0;
    end if;

    return next c;
  end loop;
end;
$$;

-- =============================================================================
-- Комментировать и реагировать на контент другого из пары — нельзя
-- =============================================================================

/**
 * Можно ли `p_actor` откликнуться (комментарием или реакцией) на контент
 * `p_author` в чате `p_chat`: не из пары с блокировкой. Посты канала — не
 * человек, к ним блокировка не относится; `p_chat` null — без этого
 * исключения (комментарий).
 */
create function public.require_contact_allowed(p_actor uuid, p_author uuid, p_chat uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_author is null or p_actor is null or p_author = p_actor then
    return;
  end if;

  if exists (select 1 from public.chats where id = p_chat and kind = 'channel_posts') then
    return;
  end if;

  if public.blocked_pair(p_actor, p_author) then
    raise exception 'Пользователь недоступен' using errcode = 'OPN08';
  end if;
end;
$$;

/** Чат виден человеку (заявка — только двоим); иначе — «не найдено». */
create function public.require_chat_readable_by(p_chat uuid, p_user uuid, p_what text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.chats c
    where c.id = p_chat and c.request_pending and not (p_user = any (c.founding_member_ids))
  ) then
    raise exception '% not found', p_what using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.prepare_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.messages;
  target_pop public.pops;
  pop_chat uuid;
  root_parent uuid;
  root_author uuid;
  fragment_request text := nullif(current_setting('open.comment_fragment', true), '');
begin
  new.created_at := now();
  new.edited_at := null;
  new.deleted_at := null;
  new.replies_count := 0;
  new.fragment_id := null;

  if fragment_request is not null then
    perform set_config('open.comment_fragment', '', true);
  end if;

  if new.pop_id is not null then
    -- for key share — как у сообщения: счётчик комментариев обновляет строку
    -- попа без ключевых колонок и с блокировкой не конфликтует.
    select * into target_pop
    from public.pops
    where id = new.pop_id
    for key share;

    select posts_chat_id into pop_chat
    from public.channels
    where id = target_pop.channel_id and deleted_at is null;

    if target_pop.id is null or target_pop.deleted_at is not null or pop_chat is null then
      raise exception 'pop not found' using errcode = 'P0002';
    end if;

    new.chat_id := pop_chat;
  else
    select * into target
    from public.messages
    where id = new.message_id
    for key share;

    if target.id is null or target.deleted_at is not null then
      raise exception 'message not found' using errcode = 'P0002';
    end if;

    perform public.require_chat_readable_by(target.chat_id, new.author_id, 'message');

    if target.kind = 'system' then
      raise exception 'system messages cannot be commented' using errcode = '22023';
    end if;

    if target.kind = 'forward' then
      raise exception 'forwards take no comments: comment on the originals' using errcode = '22023';
    end if;

    if target.kind = 'comment_forward' then
      raise exception 'forwarded comments take no comments' using errcode = '22023';
    end if;

    perform public.require_contact_allowed(new.author_id, target.author_id, target.chat_id);
  end if;

  if fragment_request is not null then
    if new.message_id is null then
      raise exception 'only message text has fragments' using errcode = '22023';
    end if;

    if new.thread_root_id is not null then
      raise exception 'only a top-level comment can quote a fragment' using errcode = '22023';
    end if;

    new.fragment_id := public.fragment_from_request(new.message_id, fragment_request::jsonb);
  end if;

  -- Удалённый корень тред не закрывает. Чужую цель у корня отвергнет
  -- составной внешний ключ.
  if new.thread_root_id is not null then
    select thread_root_id, author_id into root_parent, root_author
    from public.comments where id = new.thread_root_id;

    if root_parent is not null then
      raise exception 'replies go into the thread of a top-level comment' using errcode = '22023';
    end if;

    -- Ветка под комментарием другого из пары — тоже его контент.
    if root_author is not null and root_author <> new.author_id
      and public.blocked_pair(new.author_id, root_author) then
      raise exception 'Пользователь недоступен' using errcode = 'OPN08';
    end if;
  end if;

  if new.pop_id is not null then
    new.audience := case
      when public.can_publish_in_channel(target_pop.channel_id, new.author_id) then 'member'
      else 'visitor'
    end;
  else
    new.audience := case
      when exists (
        select 1 from public.chat_members
        where chat_id = target.chat_id and user_id = new.author_id
      ) then 'member'
      else 'visitor'
    end;
  end if;

  return new;
end;
$$;

create or replace function public.prepare_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target record;
  revived boolean;
  member_counts jsonb;
  visitor_counts jsonb;
  counts jsonb;
  taken int;
  content_author uuid;
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

  -- Снятие реакции (deleted_at) сюда не доходит: ветка выше вернулась раньше.
  if new.target_type <> 'pop' then
    perform public.require_chat_readable_by(target.chat_id, new.user_id, new.target_type);

    if new.target_type = 'comment' then
      select c.author_id into content_author from public.comments c where c.id = new.target_id;
    else
      select m.author_id into content_author from public.messages m where m.id = target.message_id;
    end if;

    -- Комментарий — всегда человек, даже под постом канала: без исключения.
    perform public.require_contact_allowed(
      new.user_id,
      content_author,
      case when new.target_type = 'comment' then null else target.chat_id end
    );
  end if;

  new.chat_id := target.chat_id;
  new.updated_at := now();

  if new.target_type = 'pop' then
    new.audience := case
      when public.can_publish_in_channel(target.channel_id, new.user_id) then 'member'
      else 'visitor'
    end;
  else
    new.audience := case
      when exists (
        select 1 from public.chat_members
        where chat_id = target.chat_id and user_id = new.user_id
      ) then 'member'
      else 'visitor'
    end;
  end if;

  if new.target_type = 'message' then
    select m.member_reactions, m.visitor_reactions into member_counts, visitor_counts
    from public.messages m
    where m.id = new.target_id
    for no key update;

    counts := case when new.audience = 'member' then member_counts else visitor_counts end;
  elsif new.target_type = 'fragment' then
    if tg_op = 'INSERT' or revived then
      perform public.replace_cluster_reaction(new.target_id, new.user_id);
    end if;

    select f.member_reactions, f.visitor_reactions into member_counts, visitor_counts
    from public.message_fragments f
    where f.id = new.target_id
    for no key update;

    counts := case when new.audience = 'member' then member_counts else visitor_counts end;
  elsif new.target_type = 'comment' then
    select c.member_reactions, c.visitor_reactions into member_counts, visitor_counts
    from public.comments c
    where c.id = new.target_id
    for no key update;

    counts := public.reaction_counts_merge(member_counts, visitor_counts);
  else
    select p.reactions into counts
    from public.pops p
    where p.id = new.target_id
    for no key update;
  end if;

  if not counts ? new.emoji then
    select count(*) into taken from jsonb_object_keys(counts);

    -- Смена моей реакции: если я был единственным у прежней, её место
    -- освобождается тем же движением. У комментария и попа ряд общий.
    if tg_op = 'UPDATE' and old.deleted_at is null and old.emoji <> new.emoji
       and (new.target_type not in ('message', 'fragment') or old.audience = new.audience)
       and (counts ->> old.emoji)::int = 1 then
      taken := taken - 1;
    end if;

    if taken >= public.reaction_kinds_limit(new.target_type, new.audience) then
      raise exception 'reaction kinds limit reached'
        using errcode = 'OR001', hint = 'reaction_limit';
    end if;
  end if;

  return new;
end;
$$;

-- =============================================================================
-- Приглашение в группу
-- =============================================================================

create or replace function public.invite_to_chat(target_chat uuid, invitee_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  chat public.chats;
  wanted uuid[];
  fresh uuid[];
  strangers uuid[];
  inviter_name text;
  invitee uuid;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if invitee_ids is null or cardinality(invitee_ids) = 0 or array_position(invitee_ids, null) is not null then
    raise exception 'Выберите, кого позвать' using errcode = '22023';
  end if;

  select array_agg(distinct x order by x) into wanted from unnest(invitee_ids) as x;

  if cardinality(wanted) > 50 then
    raise exception 'Слишком много людей за раз' using errcode = '22023';
  end if;

  select * into chat from public.chats where id = target_chat and deleted_at is null for update;

  if chat.id is null then
    raise exception 'Чат не найден' using errcode = 'P0002';
  end if;

  if chat.kind <> 'group' then
    raise exception 'Позвать можно только в группу' using errcode = '22023';
  end if;

  if not exists (select 1 from public.chat_members where chat_id = target_chat and user_id = me) then
    raise exception 'Звать в группу может только участник' using errcode = '42501';
  end if;

  if me = any (wanted) then
    raise exception 'Нельзя позвать самого себя' using errcode = '22023';
  end if;

  if (select count(*) from public.profiles where id = any (wanted) and deleted_at is null)
    <> cardinality(wanted) then
    raise exception 'Пользователь не найден' using errcode = '22023';
  end if;

  if exists (select 1 from unnest(wanted) as x where public.blocked_pair(me, x)) then
    raise exception 'Пользователь недоступен' using errcode = 'OPN08';
  end if;

  select coalesce(array_agg(x order by x), '{}') into fresh
  from unnest(wanted) as x
  where not exists (select 1 from public.chat_members where chat_id = target_chat and user_id = x)
    and not exists (
      select 1 from public.chat_invites
      where chat_id = target_chat and invitee_id = x and status = 'pending'
    );

  if cardinality(fresh) = 0 then
    return 0;
  end if;

  select coalesce(array_agg(x), '{}') into strangers
  from unnest(fresh) as x
  where not public.are_friends(me, x);

  if cardinality(strangers) > 0 then
    perform public.require_not_restricted(me);
    perform public.check_contact_request_limit(me, cardinality(strangers));

    insert into public.contact_request_log (requester_id, kind)
    select me, 'group_invite' from unnest(strangers);
  end if;

  -- Прежняя заявка (отклонённая или принятая до удаления из группы) — не
  -- публичная история: на её место встаёт новая, с новым позвавшим.
  delete from public.chat_invites
  where chat_id = target_chat and invitee_id = any (fresh) and status <> 'pending';

  insert into public.chat_invites (chat_id, inviter_id, invitee_id)
  select target_chat, me, x from unnest(fresh) as x;

  foreach invitee in array fresh loop
    perform public.post_member_event(target_chat, 'member_invited', me, invitee);
  end loop;

  select display_name into inviter_name from public.profiles where id = me;

  begin
    foreach invitee in array fresh loop
      perform realtime.send(
        jsonb_build_object(
          'chat_id', target_chat,
          'inviter_id', me,
          'inviter_name', inviter_name,
          'chat_title', chat.title
        ),
        'invite',
        'user:' || invitee::text,
        true
      );
    end loop;
  exception
    when others then null;
  end;

  perform public.notify_chat_changed(target_chat);

  return cardinality(fresh);
end;
$$;

-- =============================================================================
-- Заявка в друзья
-- =============================================================================

create or replace function public.send_friend_request(p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_friend_target(p_user);
  f public.friendships;
begin
  if public.blocked_pair(me, p_user) then
    raise exception 'Пользователь недоступен' using errcode = 'OPN08';
  end if;

  perform public.lock_friend_pair(me, p_user);

  f := public.friendship_of(me, p_user);

  if f.id is not null then
    if f.status = 'accepted' then
      return 'friends';
    end if;

    -- Он звал меня, я отказал, а он потом отозвал заявку: его согласия больше
    -- нет, и моё «Добавить» — новая заявка уже от меня.
    if f.addressee_id = me and f.withdrawn_at is not null then
      perform public.require_not_restricted(me);

      if public.friend_request_limit_reached(me) then
        raise exception 'Слишком много заявок в друзья, попробуйте позже' using errcode = 'OPN05';
      end if;

      delete from public.friendships where id = f.id;
      insert into public.friendships (requester_id, addressee_id) values (me, p_user);
      insert into public.friend_request_log (requester_id) values (me);

      return 'outgoing';
    end if;

    -- Встречная заявка — принятие: это ответ, а не обращение к незнакомому.
    if f.addressee_id = me then
      update public.friendships
      set status = 'accepted', accepted_at = now(), responded_at = coalesce(responded_at, now()),
          withdrawn_at = null
      where id = f.id;

      return 'friends';
    end if;

    -- Моя заявка: неотвеченная — ничего не меняется; отклонённая и
    -- отозванная — снова «отправлена» для меня, получатель её не видит.
    if f.withdrawn_at is not null then
      update public.friendships set withdrawn_at = null where id = f.id;
    end if;

    return 'outgoing';
  end if;

  perform public.require_not_restricted(me);

  if public.friend_request_limit_reached(me) then
    raise exception 'Слишком много заявок в друзья, попробуйте позже' using errcode = 'OPN05';
  end if;

  insert into public.friendships (requester_id, addressee_id) values (me, p_user);
  insert into public.friend_request_log (requester_id) values (me);

  return 'outgoing';
end;
$$;

-- =============================================================================
-- Люди: знакомые, поиск, списки
-- =============================================================================

/** Друзья и участники моих личек и групп, кроме меня и тех, с кем блокировка. */
create or replace function public.known_people_ids(p_me uuid)
returns table (person_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select k.person_id
  from (
    select case when f.requester_id = p_me then f.addressee_id else f.requester_id end as person_id
    from public.friendships f
    where f.status = 'accepted' and (f.requester_id = p_me or f.addressee_id = p_me)
    union
    select them.user_id
    from public.chat_members mine
    join public.chats c on c.id = mine.chat_id and c.kind in ('direct', 'group') and c.deleted_at is null
    join public.chat_members them on them.chat_id = mine.chat_id and them.user_id <> p_me
    where mine.user_id = p_me
  ) k
  where not public.blocked_pair(p_me, k.person_id)
$$;

/**
 * Пустой запрос — знакомые. Запрос — знакомые с совпадением и остальные, кто
 * пускает меня в поиск (блокировка — «не пускает», см. `privacy_allows`).
 * Ограниченному аккаунту — только знакомые.
 */
create or replace function public.search_people(
  query text default null,
  after_name text default null,
  after_id uuid default null,
  page_size int default 30
)
returns table (
  id uuid,
  display_name text,
  username text,
  avatar_url text
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  stripped text := btrim(ltrim(btrim(coalesce(query, '')), '@'));
  needle text := public.search_norm(stripped);
  pattern text;
  user_pattern text;
  restricted boolean;
  lim int := least(greatest(coalesce(page_size, 30), 1), 50);
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  perform public.search_rate_hit('people');

  restricted := public.contact_restricted(me);
  pattern := case when needle <> '' then public.search_like(needle) end;
  user_pattern := case when stripped <> '' then public.search_like(lower(stripped)) end;

  return query
  with known as (
    select k.person_id from public.known_people_ids(me) k
  )
  select p.id, p.display_name, p.username, p.avatar_url
  from public.profiles p
  where p.deleted_at is null
    and p.id <> me
    and (
      (pattern is null and p.id in (select person_id from known))
      or (
        pattern is not null
        and (
          public.search_norm(p.display_name) like pattern
          or lower(p.username) like user_pattern
        )
        and (
          p.id in (select person_id from known)
          or (not restricted and public.privacy_allows('account_search_visibility', p.id, me))
        )
      )
    )
    and (
      after_id is null
      or (coalesce(p.display_name, ''), p.id) > (coalesce(after_name, ''), after_id)
    )
  order by coalesce(p.display_name, ''), p.id
  limit lim;
end;
$$;

create or replace function public.search_entities(
  query text,
  mine_limit int default 50,
  global_limit int default 20
)
returns table (
  section text,
  entity_kind text,
  id uuid,
  chat_id uuid,
  channel_id uuid,
  peer_id uuid,
  title text,
  username text,
  avatar_url text,
  subscribed boolean,
  subscribers_count int
)
language plpgsql
volatile
security definer
set search_path = public, extensions
set pg_trgm.word_similarity_threshold = 0.45
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  q record;
  pattern text;
  fuzzy boolean;
  user_pattern text;
  user_fuzzy boolean;
  restricted boolean;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  select * into q from public.search_parse(query);

  if q.text_query = '' then
    return;
  end if;

  perform public.search_rate_hit('entities');

  restricted := public.contact_restricted(me);
  pattern := public.search_like(q.text_query);
  fuzzy := char_length(q.text_query) >= 4;
  user_pattern := case when q.username_query is not null then public.search_like(q.username_query) end;
  user_fuzzy := char_length(q.username_query) >= 4;

  return query
  with mine as (
    select * from public.searchable_chats()
  ),
  mine_ranked as (
    select
      m.*,
      public.search_level(lower(m.username), q.username_query) as u_level,
      public.search_level(public.search_norm(m.title), q.text_query) as t_level
    from mine m
    where (q.kind is null or m.entity_kind = q.kind)
      and (m.entity_kind <> 'direct' or not m.subscribed or public.chat_found_by_names(m.chat_id, me))
  ),
  global_candidates as (
    select
      'channel'::text as entity_kind,
      ch.id,
      ch.posts_chat_id as chat_id,
      ch.id as channel_id,
      null::uuid as peer_id,
      ch.title,
      ch.username,
      ch.avatar_url,
      ch.subscribers_count
    from public.channels ch
    where ch.deleted_at is null
      and (q.kind is null or q.kind = 'channel')
      and (
        public.search_norm(ch.title) like pattern
        or (fuzzy and q.text_query <% public.search_norm(ch.title))
        or lower(ch.username) like user_pattern
        or (user_fuzzy and q.username_query <% lower(ch.username))
      )
      and ch.posts_chat_id not in (select m.chat_id from mine m)
    union all
    select
      'group', g.id, g.id, null, null, coalesce(nullif(btrim(g.title), ''), 'Групповой чат'),
      g.username, g.avatar_url, g.subscribers_count
    from public.chats g
    where g.kind = 'group' and g.username is not null and g.deleted_at is null
      and (q.kind is null or q.kind = 'group')
      and (
        public.search_norm(g.title) like pattern
        or (fuzzy and q.text_query <% public.search_norm(g.title))
        or lower(g.username) like user_pattern
        or (user_fuzzy and q.username_query <% lower(g.username))
      )
      and g.id not in (select m.chat_id from mine m)
    union all
    select
      'person', p.id, null, null, p.id, coalesce(p.display_name, p.username), p.username,
      p.avatar_url, null
    from public.profiles p
    where p.username is not null and p.deleted_at is null
      and q.kind is null
      and p.id <> me
      and (
        public.search_norm(p.display_name) like pattern
        or (fuzzy and q.text_query <% public.search_norm(p.display_name))
        or lower(p.username) like user_pattern
        or (user_fuzzy and q.username_query <% lower(p.username))
      )
      -- Человек, с которым у меня диалог, уже стоит в «Чатах» этим диалогом.
      and p.id not in (
        select m.peer_id from mine m where m.peer_id is not null
      )
      and public.privacy_allows('account_search_visibility', p.id, me)
      and (not restricted or p.id in (select k.person_id from public.known_people_ids(me) k))
  ),
  global_ranked as (
    select
      g.*,
      public.search_level(lower(g.username), q.username_query) as u_level,
      public.search_level(public.search_norm(g.title), q.text_query) as t_level
    from global_candidates g
  ),
  both_ranked as (
    select
      'mine'::text as section, r.entity_kind,
      case when r.entity_kind = 'channel' then r.channel_id else r.chat_id end as id,
      r.chat_id, r.channel_id, r.peer_id, r.title, r.username, r.avatar_url,
      r.subscribed, r.subscribers_count, r.u_level, r.t_level
    from mine_ranked r
    where r.u_level > 0 or r.t_level > 0
    union all
    select
      'global', r.entity_kind, r.id, r.chat_id, r.channel_id, r.peer_id, r.title, r.username,
      r.avatar_url, false, r.subscribers_count, r.u_level, r.t_level
    from global_ranked r
    where r.u_level > 0 or r.t_level > 0
  ),
  ordered as (
    select
      b.*,
      row_number() over (
        partition by b.section
        order by
          case when q.by_username then b.u_level else greatest(b.u_level, b.t_level) end desc,
          case when q.by_username then b.t_level else least(b.u_level, b.t_level) end desc,
          greatest(
            extensions.similarity(public.search_norm(b.title), q.text_query),
            coalesce(extensions.similarity(lower(b.username), q.username_query), 0)
          ) desc,
          public.search_norm(b.title),
          b.id
      ) as position
    from both_ranked b
  )
  select
    o.section, o.entity_kind, o.id, o.chat_id, o.channel_id, o.peer_id, o.title, o.username,
    o.avatar_url, o.subscribed, o.subscribers_count
  from ordered o
  where o.position <= case
    when o.section = 'mine' then least(greatest(coalesce(mine_limit, 50), 1), 200)
    else least(greatest(coalesce(global_limit, 20), 1), 30)
  end
  order by o.section desc, o.position;
end;
$$;

create or replace function public.list_friends(
  p_user uuid,
  p_limit int default 30,
  p_before_accepted_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  friendship_id uuid,
  accepted_at timestamptz,
  user_id uuid,
  display_name text,
  username text,
  avatar_url text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  peers uuid[] := public.my_block_peers();
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if not public.privacy_allows('friends_list_visibility', p_user, me) then
    raise exception 'Список друзей скрыт' using errcode = '42501';
  end if;

  -- Свой список — не сбор чужих данных.
  if p_user <> me then
    perform public.search_rate_hit('friends');
  end if;

  return query
  select f.id, f.accepted_at, p.id, p.display_name, p.username, p.avatar_url
  from public.friendships f
  join public.profiles p
    on p.id = case when f.requester_id = p_user then f.addressee_id else f.requester_id end
   and p.deleted_at is null
  where f.status = 'accepted'
    and (f.requester_id = p_user or f.addressee_id = p_user)
    and p.id <> all (peers)
    and (
      p_before_accepted_at is null
      or (f.accepted_at, f.id) < (p_before_accepted_at, p_before_id)
    )
  order by f.accepted_at desc, f.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

-- =============================================================================
-- Права
-- =============================================================================

revoke execute on function public.chat_readable(uuid) from public, anon;
revoke execute on function public.blocker_message_visible(uuid) from public, anon;
revoke execute on function public.realtime_chat_readable(text) from public, anon;
-- Политики и представление зовут их с правами смотрящего; ответ — только про
-- то, что смотрящему и так видно.
grant execute on function public.chat_readable(uuid) to authenticated;
grant execute on function public.blocker_message_visible(uuid) to authenticated;
grant execute on function public.realtime_chat_readable(text) to authenticated;

revoke execute on function public.last_message_preview(public.chats) from public, anon;
grant execute on function public.last_message_preview(public.chats) to authenticated;

revoke execute on function public.is_blocked_by(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.require_contact_allowed(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.require_chat_readable_by(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.known_people_ids(uuid) from public, anon, authenticated;
