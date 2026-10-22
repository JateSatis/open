-- Приватность, этап 4: функции, отдающие людей.
--
-- Все функции и рассылки, которые отдают имя, username или фото человека,
-- теперь берут его из `person_card`: вне диалогов (профиль, поиск, друзья,
-- подписчики) — по профильной настройке, в контексте чата — ещё и по
-- настройке «Кто видит моё имя в моих диалогах». Поиск сверяет запрос с тем,
-- что ищущий увидит: скрытого — по псевдониму, не по настоящему имени и
-- username.
--
-- Рассылки: в общих топиках (`chat:<id>`) людей больше нет — ни id, ни
-- имён; клиент перечитывает строки сам. В личном топике `user:<id>` — человек
-- глазами получателя.

-- =============================================================================
-- Участники чатов
-- =============================================================================

drop function public.chat_people(uuid[]);

/**
 * Участники чатов глазами смотрящего: каждый по своей настройке в этом
 * чате. Подменённому в диалоге — непрозрачный id (`opaque`), профиля за ним
 * нет. Отметки прочтения и вступления — как раньше, по видимости времени.
 */
create function public.chat_people(chat_ids uuid[])
returns table (
  chat_id uuid,
  user_id uuid,
  display_name text,
  avatar_url text,
  username text,
  last_read_at timestamptz,
  joined_at timestamptz,
  "position" integer,
  opaque boolean
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
  ),
  members as (
    select
      cm.chat_id,
      cm.user_id,
      cm.last_read_at,
      cm.joined_at,
      s.visible,
      s.reads,
      (row_number() over (partition by cm.chat_id order by cm.joined_at, cm.user_id) - 1)::int as rank
    from public.chat_members cm
    join shown s on s.id = cm.chat_id
  )
  select
    m.chat_id,
    card.id,
    card.display_name,
    card.avatar_url,
    card.username,
    case when m.reads then m.last_read_at end,
    case when m.visible then m.joined_at end,
    m.rank,
    card.opaque
  from members m
  cross join lateral public.person_card(m.user_id, auth.uid(), m.chat_id) card
  where card.id is not null
  order by m.chat_id, m.rank;
end;
$$;

-- Название чужого диалога — глазами того, кому оно показывается.
create or replace function public.outsider_chat_title(target_chat uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.chat_title_for(target_chat, auth.uid())
$$;

/**
 * Чаты другого человека — те, где он участник и не подменён для смотрящего:
 * иначе по списку его чатов связались бы его профиль и псевдонимы в диалогах.
 * Свежие сверху; чаты со скрытым временем — в конце.
 */
create function public.list_person_chats(p_person uuid, p_offset integer default 0, p_limit integer default 30)
returns setof public.chat_rows
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  return query
  select r.*
  from public.chat_rows r
  join public.chat_members cm on cm.chat_id = r.id and cm.user_id = p_person
  where not public.dialogue_masked(p_person, auth.uid(), r.id)
  order by public.last_message_at(r) desc nulls last, r.id
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

-- =============================================================================
-- Сводка чата
-- =============================================================================

drop function public.chat_info_summary(uuid);

/** Владелец группы — глазами смотрящего; остальное — как было. */
create function public.chat_info_summary(target_chat uuid)
returns table (owner_id uuid, photos integer, videos integer, voices integer, common_groups integer)
language sql
stable
security definer
set search_path = public
as $$
  with chat as (
    select c.id, c.kind, c.owner_id
    from public.chats c
    where c.id = target_chat and public.chat_readable(c.id)
  ),
  media as (
    select
      count(*) filter (where a.mime_type like 'image/%')::int as photos,
      count(*) filter (where a.mime_type like 'video/%')::int as videos
    from public.message_rows m
    join public.attachments a on a.message_id = m.id
    where m.chat_id = target_chat
      and m.kind = 'media'
      and not m.hidden
      and a.pop_id is null
  ),
  voices as (
    select count(*)::int as voices
    from public.message_rows m
    where m.chat_id = target_chat
      and m.kind in ('voice', 'video_note')
      and not m.hidden
  ),
  other as (
    select cm.user_id
    from chat
    join public.chat_members cm on cm.chat_id = chat.id
    where chat.kind = 'direct'
      and cm.user_id <> auth.uid()
      and exists (
        select 1 from public.chat_members mine
        where mine.chat_id = chat.id and mine.user_id = auth.uid()
      )
    limit 1
  )
  select
    public.person_shown_id(chat.owner_id, auth.uid(), chat.id),
    media.photos,
    media.videos,
    voices.voices,
    coalesce((
      select count(*)::int
      from other
      join public.chat_members them on them.user_id = other.user_id
      join public.chats g on g.id = them.chat_id and g.kind = 'group' and g.deleted_at is null
      where exists (
        select 1 from public.chat_members me
        where me.chat_id = g.id and me.user_id = auth.uid()
      )
    ), 0)
  from chat, media, voices;
$$;

-- =============================================================================
-- Голосовые и фрагменты
-- =============================================================================

drop function public.list_chat_voices(uuid, bigint, integer);

create function public.list_chat_voices(target_chat uuid, before_seq bigint default null, page_size integer default 30)
returns table (
  message_id uuid,
  kind text,
  seq bigint,
  created_at timestamptz,
  author_id uuid,
  author_name text,
  attachment_id uuid,
  url text,
  poster_url text,
  mime_type text,
  duration_ms integer,
  waveform smallint[],
  author_opaque boolean
)
language sql
stable
set search_path = public
as $$
  select m.id, m.kind, m.seq, m.created_at, m.author_id, m.author_name,
         a.id, a.url, a.poster_url, a.mime_type, a.duration_ms, a.waveform, m.author_opaque
  from public.message_rows m
  join public.attachments a on a.message_id = m.id
  where m.chat_id = target_chat
    and m.kind in ('voice', 'video_note')
    and not m.hidden
    and (before_seq is null or m.seq < before_seq)
  order by m.seq desc
  limit least(greatest(page_size, 1), 100);
$$;

-- Автор фрагмента клиенту нужен только как «мой»: чужой — null.
create or replace function public.list_message_fragments(target_message uuid)
returns table (
  id uuid,
  message_id uuid,
  author_id uuid,
  start_offset integer,
  end_offset integer,
  exact_text text,
  anchor_state text,
  member_reactions jsonb,
  visitor_reactions jsonb,
  reactions_count integer,
  comments_count integer,
  my_emoji text,
  created_at timestamptz,
  cluster_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    f.id, f.message_id,
    case when f.author_id = auth.uid() then f.author_id end,
    f.start_offset, f.end_offset, f.exact_text, f.anchor_state,
    f.member_reactions, f.visitor_reactions, f.reactions_count, f.comments_count,
    (
      select r.emoji from public.reactions r
      where r.target_type = 'fragment' and r.target_id = f.id
        and r.user_id = auth.uid() and r.deleted_at is null
    ),
    f.created_at,
    f.cluster_id
  from public.message_fragments f
  join public.message_rows m on m.id = f.message_id
  where f.message_id = target_message
    and f.deleted_at is null
    and not m.hidden
  order by f.start_offset, f.end_offset, f.created_at
$$;

-- Людей области считает по всем реакциям и комментариям — с правами
-- владельца; текст — из представления (заглушка заблокировавшего — без него).
create or replace function public.fragment_area_summary(target_message uuid, area_start integer, area_end integer)
returns table (
  fragment_ids uuid[],
  area_text text,
  member_reactions jsonb,
  visitor_reactions jsonb,
  reactions_count integer,
  comments_count integer,
  people_count integer,
  my_cluster_id uuid,
  my_emoji text,
  my_fragment_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  with area as (
    select f.*
    from public.message_fragments f
    where f.id in (select public.area_fragment_ids(target_message, area_start, area_end))
      and exists (select 1 from public.message_rows m where m.id = target_message and not m.hidden)
  ),
  mine as (
    select * from public.fragment_area_mine(target_message, area_start, area_end)
  )
  select
    coalesce((select array_agg(a.id order by a.start_offset, a.end_offset, a.id) from area a), '{}'),
    (
      select substr(m.text, greatest(area_start, 0) + 1, greatest(area_end - greatest(area_start, 0), 0))
      from public.message_rows m where m.id = target_message
    ),
    (
      select coalesce(jsonb_object_agg(e.key, e.total), '{}'::jsonb)
      from (
        select x.key, sum(x.value::int) as total
        from area a, jsonb_each_text(a.member_reactions) x group by x.key
      ) e
    ),
    (
      select coalesce(jsonb_object_agg(e.key, e.total), '{}'::jsonb)
      from (
        select x.key, sum(x.value::int) as total
        from area a, jsonb_each_text(a.visitor_reactions) x group by x.key
      ) e
    ),
    coalesce((select sum(a.reactions_count)::int from area a), 0),
    coalesce((select sum(a.comments_count)::int from area a), 0),
    (
      select count(distinct v.user_id)::int
      from (
        select r.user_id
        from area a
        join public.reactions r on r.target_type = 'fragment' and r.target_id = a.id and r.deleted_at is null
        union all
        select c.author_id
        from area a
        join public.comments c on c.fragment_id = a.id and c.deleted_at is null
      ) v
      where v.user_id is not null
    ),
    (select mine.cluster_id from mine),
    (select mine.my_emoji from mine),
    (select mine.my_fragment_id from mine)
$$;

-- Текст сообщения клиенту из таблицы больше не читается — кластеры берут его
-- из представления (у заглушки заблокировавшего текста нет).
create or replace function public.list_message_clusters(target_message uuid)
returns table (
  id uuid,
  message_id uuid,
  start_offset integer,
  end_offset integer,
  display_start integer,
  display_end integer,
  display_text text,
  popularity double precision,
  member_reactions jsonb,
  visitor_reactions jsonb,
  reactions_count integer,
  comments_count integer,
  people_count integer,
  fragments_count integer,
  my_emoji text,
  my_fragment_id uuid,
  decision_id uuid,
  dominant_emoji text
)
language sql
stable
set search_path = public
as $$
  select
    k.id, k.message_id, k.start_offset, k.end_offset, k.display_start, k.display_end,
    substr(m.text, k.display_start + 1, k.display_end - k.display_start),
    k.popularity, k.member_reactions, k.visitor_reactions, k.reactions_count, k.comments_count,
    k.people_count,
    (
      select count(*)::int from public.message_fragments f
      where f.cluster_id = k.id and f.deleted_at is null
    ),
    mine.emoji,
    mine.target_id,
    k.decision_id,
    k.dominant_emoji
  from public.fragment_clusters k
  join public.message_rows m on m.id = k.message_id
  left join lateral (
    select r.emoji, r.target_id
    from public.reactions r
    join public.message_fragments f on f.id = r.target_id
    where r.target_type = 'fragment'
      and r.user_id = auth.uid()
      and r.deleted_at is null
      and f.cluster_id = k.id
    order by r.updated_at desc
    limit 1
  ) mine on true
  where k.message_id = target_message
  order by k.display_start
$$;

-- =============================================================================
-- Списки людей
-- =============================================================================

create or replace function public.list_friends(
  p_user uuid,
  p_limit integer default 30,
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
  select f.id, f.accepted_at, card.id, card.display_name, card.username, card.avatar_url
  from public.friendships f
  join public.profiles p
    on p.id = case when f.requester_id = p_user then f.addressee_id else f.requester_id end
   and p.deleted_at is null
  cross join lateral public.person_card(p.id, me, null) card
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

create or replace function public.list_incoming_friend_requests(
  p_limit integer default 30,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  friendship_id uuid,
  created_at timestamptz,
  user_id uuid,
  display_name text,
  username text,
  avatar_url text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  return query
  select f.id, f.created_at, card.id, card.display_name, card.username, card.avatar_url
  from public.friendships f
  join public.profiles p on p.id = f.requester_id and p.deleted_at is null
  cross join lateral public.person_card(p.id, me, null) card
  where f.addressee_id = me
    and f.status = 'pending'
    and (
      p_before_created_at is null
      or (f.created_at, f.id) < (p_before_created_at, p_before_id)
    )
  order by f.created_at desc, f.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

create or replace function public.list_blocked_users(
  p_limit integer default 30,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  block_id uuid,
  created_at timestamptz,
  user_id uuid,
  display_name text,
  username text,
  avatar_url text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  return query
  select b.id, b.created_at, card.id, card.display_name, card.username, card.avatar_url
  from public.blocks b
  join public.profiles p on p.id = b.blocked_id and p.deleted_at is null
  cross join lateral public.person_card(p.id, me, null) card
  where b.blocker_id = me
    and (
      p_before_created_at is null
      or (b.created_at, b.id) < (p_before_created_at, p_before_id)
    )
  order by b.created_at desc, b.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

-- Поиск среди подписчиков — по тому, что владелец канала видит: псевдоним
-- находится, настоящее имя скрытого — нет.
create or replace function public.list_channel_subscribers(
  target_channel uuid,
  before_created timestamptz default null,
  before_id uuid default null,
  page_size integer default 30,
  query text default null
)
returns table (
  id uuid,
  subscriber_id uuid,
  display_name text,
  username text,
  avatar_url text,
  in_chats boolean,
  subscribed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  needle text := public.search_norm(coalesce(query, ''));
  pattern text;
  user_pattern text;
begin
  if auth.uid() is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if not public.can_manage_channel(target_channel, auth.uid()) then
    raise exception 'Подписчиков видит только владелец канала' using errcode = '42501';
  end if;

  pattern := case when needle <> '' then public.search_like(needle) end;
  user_pattern := case
    when needle <> '' then public.search_like(lower(ltrim(btrim(query), '@')))
  end;

  return query
  select s.id, card.id, card.display_name, card.username, card.avatar_url, s.in_chats, s.created_at
  from public.subscriptions s
  join public.profiles p on p.id = s.subscriber_id and p.deleted_at is null
  cross join lateral public.person_card(p.id, auth.uid(), null) card
  where s.channel_id = target_channel
    and (
      pattern is null
      or public.search_norm(card.display_name) like pattern
      or lower(card.username) like user_pattern
    )
    and (before_created is null or (s.created_at, s.id) < (before_created, before_id))
  order by s.created_at desc, s.id desc
  limit least(greatest(coalesce(page_size, 30), 1), 100);
end;
$$;

create or replace function public.list_chat_subscribers(
  target_chat uuid,
  before_created timestamptz default null,
  before_id uuid default null,
  page_size integer default 30
)
returns table (
  id uuid,
  subscriber_id uuid,
  display_name text,
  username text,
  avatar_url text,
  subscribed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.chat_members cm
    where cm.chat_id = target_chat and cm.user_id = auth.uid()
  ) then
    raise exception 'Подписчиков видят только участники чата' using errcode = '42501';
  end if;

  return query
  select s.id, card.id, card.display_name, card.username, card.avatar_url, s.created_at
  from public.subscriptions s
  join public.profiles p on p.id = s.subscriber_id and p.deleted_at is null
  cross join lateral public.person_card(p.id, auth.uid(), null) card
  where s.chat_id = target_chat
    and (before_created is null or (s.created_at, s.id) < (before_created, before_id))
  order by s.created_at desc, s.id desc
  limit least(greatest(coalesce(page_size, 30), 1), 100);
end;
$$;

-- =============================================================================
-- Заявки в чат
-- =============================================================================
--
-- Позвавшего видит только позванный (политика `chat_invites`) — вне диалога,
-- по профильной настройке позвавшего.

create function public.inviter_name(public.chat_invites)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select (public.person_card($1.inviter_id, auth.uid(), null)).display_name
  where $1.invitee_id = auth.uid()
$$;

create function public.inviter_avatar_url(public.chat_invites)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select (public.person_card($1.inviter_id, auth.uid(), null)).avatar_url
  where $1.invitee_id = auth.uid()
$$;

-- =============================================================================
-- Поиск
-- =============================================================================

create or replace function public.searchable_chats()
returns table (
  chat_id uuid,
  entity_kind text,
  channel_id uuid,
  peer_id uuid,
  title text,
  username text,
  avatar_url text,
  subscribed boolean,
  subscribers_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    case when c.kind = 'channel_posts' then 'channel' else c.kind end,
    ch.id,
    peer.id,
    case
      when ch.id is not null then ch.title
      when nullif(btrim(c.title), '') is not null then c.title
      when c.kind = 'group' then 'Групповой чат'
      when member.chat_id is not null then coalesce(peer.display_name, 'Диалог')
      else public.chat_title_for(c.id, auth.uid())
    end,
    coalesce(ch.username, c.username, peer.username),
    coalesce(ch.avatar_url, c.avatar_url, peer.avatar_url),
    member.chat_id is null,
    coalesce(ch.subscribers_count, c.subscribers_count)
  from public.searchable_chat_ids() ids
  join public.chats c on c.id = ids.chat_id
  left join public.channels ch on ch.posts_chat_id = c.id
  left join public.chat_members member on member.chat_id = c.id and member.user_id = auth.uid()
  left join lateral (
    select card.id, card.display_name, card.username, card.avatar_url
    from (
      select cm.user_id as person, 0 as rank, cm.joined_at as at
      from public.chat_members cm
      where cm.chat_id = c.id and cm.user_id <> auth.uid()
      union all
      select i.invitee_id, 1, i.created_at
      from public.chat_invites i
      where i.chat_id = c.id and i.status <> 'accepted' and i.invitee_id <> auth.uid()
    ) other
    cross join lateral public.person_card(other.person, auth.uid(), c.id) card
    where card.id is not null
    order by other.rank, other.at
    limit 1
  ) peer on c.kind = 'direct' and member.chat_id is not null
$$;

/**
 * Кандидаты в поиске людей: совпадение по настоящему имени или username и
 * по общему псевдониму. Что из этого увидит ищущий, решает `person_card` —
 * совпадение потом сверяется с показанным, поэтому скрытого не найти по
 * настоящему, а открытого — по псевдониму.
 */
create function public.person_search_candidates(p_text text, p_username text, p_fuzzy boolean, p_user_fuzzy boolean)
returns table (person_id uuid)
language sql
stable
security definer
set search_path = public, extensions
set "pg_trgm.word_similarity_threshold" to '0.45'
as $$
  select p.id
  from public.profiles p
  where p.username is not null and p.deleted_at is null
    and (
      public.search_norm(p.display_name) like public.search_like(p_text)
      or (p_fuzzy and p_text <% public.search_norm(p.display_name))
      or (p_username is not null and lower(p.username) like public.search_like(p_username))
      or (p_user_fuzzy and p_username <% lower(p.username))
    )
  union
  select s.user_id
  from public.privacy_settings s
  join public.profiles p on p.id = s.user_id and p.username is not null and p.deleted_at is null
  where public.search_norm(s.identity_alias) like public.search_like(p_text)
     or (p_fuzzy and p_text <% public.search_norm(s.identity_alias))
$$;

create or replace function public.search_entities(query text, mine_limit integer default 50, global_limit integer default 20)
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
  subscribers_count integer
)
language plpgsql
security definer
set search_path = public, extensions
set "pg_trgm.word_similarity_threshold" to '0.45'
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
  people as (
    select
      'person'::text as entity_kind,
      card.id,
      null::uuid as chat_id,
      null::uuid as channel_id,
      card.id as peer_id,
      coalesce(card.display_name, card.username) as title,
      card.username,
      card.avatar_url,
      null::int as subscribers_count
    from public.person_search_candidates(q.text_query, q.username_query, fuzzy, user_fuzzy) cand
    cross join lateral public.person_card(cand.person_id, me, null) card
    where q.kind is null
      and cand.person_id <> me
      and card.id is not null
      and (
        public.search_norm(card.display_name) like pattern
        or (fuzzy and q.text_query <% public.search_norm(card.display_name))
        or lower(card.username) like user_pattern
        or (user_fuzzy and q.username_query <% lower(card.username))
      )
      -- Человек, с которым у меня диалог, уже стоит в «Чатах» этим диалогом.
      and cand.person_id not in (
        select m.peer_id from mine m where m.peer_id is not null
      )
      and public.privacy_allows('account_search_visibility', cand.person_id, me)
      and (not restricted or cand.person_id in (select k.person_id from public.known_people_ids(me) k))
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
    select * from people
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

create or replace function public.search_people(
  query text default null,
  after_name text default null,
  after_id uuid default null,
  page_size integer default 30
)
returns table (id uuid, display_name text, username text, avatar_url text)
language plpgsql
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
  ),
  candidates as (
    select k.person_id from known k where pattern is null
    union
    select p.id
    from public.profiles p
    where pattern is not null
      and (
        public.search_norm(p.display_name) like pattern
        or lower(p.username) like user_pattern
      )
    union
    select s.user_id
    from public.privacy_settings s
    where pattern is not null
      and public.search_norm(s.identity_alias) like pattern
  ),
  shown as (
    select card.*
    from candidates c
    join public.profiles p on p.id = c.person_id and p.deleted_at is null and p.id <> me
    cross join lateral public.person_card(p.id, me, null) card
    where card.id is not null
      and (
        pattern is null
        or public.search_norm(card.display_name) like pattern
        or lower(card.username) like user_pattern
      )
      and (
        p.id in (select person_id from known)
        or (pattern is not null and not restricted and public.privacy_allows('account_search_visibility', p.id, me))
      )
  )
  select s.id, s.display_name, s.username, s.avatar_url
  from shown s
  where after_id is null
    or (coalesce(s.display_name, ''), s.id) > (coalesce(after_name, ''), after_id)
  order by coalesce(s.display_name, ''), s.id
  limit lim;
end;
$$;

drop function public.search_chat_messages(uuid, text, bigint, integer);

create function public.search_chat_messages(
  target_chat uuid,
  query text,
  before_seq bigint default null,
  page_size integer default 30
)
returns table (
  message_id uuid,
  seq bigint,
  author_id uuid,
  author_name text,
  text text,
  created_at timestamptz,
  author_opaque boolean
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  needle text;
  tsq tsquery;
  pattern text;
  use_like boolean;
  open_chat boolean;
  visible boolean;
  lim int := least(greatest(coalesce(page_size, 30), 1), 100);
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  needle := public.search_norm(query);

  if needle is null or needle = '' then
    return;
  end if;

  select
    c.kind = 'channel_posts'
      or exists (select 1 from public.chat_members cm where cm.chat_id = c.id and cm.user_id = me)
  into open_chat
  from public.chats c
  where c.id = target_chat and c.deleted_at is null
    -- Непринятую заявку на диалог видят только двое — и в поиске тоже.
    and (not c.request_pending or me = any (c.founding_member_ids));

  if open_chat is null then
    return;
  end if;

  tsq := public.search_tsquery(needle);
  pattern := public.search_like(needle);
  use_like := char_length(needle) >= 3;
  visible := public.chat_time_visible(target_chat);

  return query
  select
    m.id, m.seq, card.id, card.display_name, m.text,
    case when visible then m.created_at end,
    coalesce(card.opaque, false)
  from public.messages m
  left join lateral public.person_card(m.author_id, me, m.chat_id) card on true
  where m.chat_id = target_chat
    and m.deleted_at is null and m.kind in ('text', 'media') and m.text is not null
    and (before_seq is null or m.seq < before_seq)
    and (
      (tsq is not null and public.search_tsv(m.text) @@ tsq)
      or (use_like and public.search_norm(m.text) like pattern)
    )
    and (open_chat or public.message_found_by_author(m.chat_id, m.author_id, me))
  order by m.seq desc
  limit lim;
end;
$$;

drop function public.search_messages(text, bigint, integer);

create function public.search_messages(query text, before_seq bigint default null, page_size integer default 30)
returns table (
  message_id uuid,
  chat_id uuid,
  chat_kind text,
  channel_id uuid,
  chat_title text,
  chat_avatar_url text,
  author_id uuid,
  author_name text,
  text text,
  seq bigint,
  created_at timestamptz,
  fuzzy boolean,
  author_opaque boolean
)
language plpgsql
stable
security definer
set search_path = public, extensions
set "pg_trgm.word_similarity_threshold" to '0.45'
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  needle text;
  tsq tsquery;
  pattern text;
  use_like boolean;
  use_fuzzy boolean := false;
  chat_ids uuid[];
  open_ids uuid[];
  lim int := least(greatest(coalesce(page_size, 30), 1), 100);
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  needle := (select p.text_query from public.search_parse(query) p);

  if needle is null or needle = '' then
    return;
  end if;

  tsq := public.search_tsquery(needle);
  pattern := public.search_like(needle);
  -- Подстрока короче трёх символов триграммный индекс не сужает — прошёл бы
  -- весь индекс. Короткому запросу хватает начала слова.
  use_like := char_length(needle) >= 3;
  chat_ids := array(select s.chat_id from public.searchable_chat_ids() s);
  -- Где автор не важен: мои чаты и чаты постов каналов.
  open_ids := array(
    select c.id from public.chats c
    where c.id = any (chat_ids)
      and (
        c.kind = 'channel_posts'
        or exists (select 1 from public.chat_members cm where cm.chat_id = c.id and cm.user_id = me)
      )
  );

  if char_length(needle) >= 4 and not exists (
    select 1 from public.messages m
    where m.deleted_at is null and m.kind in ('text', 'media') and m.text is not null
      and m.chat_id = any (chat_ids)
      and (
        (tsq is not null and public.search_tsv(m.text) @@ tsq)
        or (use_like and public.search_norm(m.text) like pattern)
      )
      and (
        m.chat_id = any (open_ids)
        or public.message_found_by_author(m.chat_id, m.author_id, me)
      )
  ) then
    use_fuzzy := true;
  end if;

  return query
  with hits as (
    select m.id, m.chat_id, m.author_id, m.text, m.seq, m.created_at
    from public.messages m
    where m.deleted_at is null and m.kind in ('text', 'media') and m.text is not null
      and m.chat_id = any (chat_ids)
      and (before_seq is null or m.seq < before_seq)
      and case
        when use_fuzzy then needle <% public.search_norm(m.text)
        else (tsq is not null and public.search_tsv(m.text) @@ tsq)
          or (use_like and public.search_norm(m.text) like pattern)
      end
      and (
        m.chat_id = any (open_ids)
        or public.message_found_by_author(m.chat_id, m.author_id, me)
      )
    order by m.seq desc
    limit lim
  ),
  faces as (
    select * from public.searchable_chats() f
    where f.chat_id in (select h.chat_id from hits h)
  )
  select
    f.id,
    f.chat_id,
    face.entity_kind,
    face.channel_id,
    face.title,
    face.avatar_url,
    card.id,
    coalesce(card.display_name, 'Без имени'),
    f.text,
    f.seq,
    case when public.chat_time_visible(f.chat_id) then f.created_at end,
    use_fuzzy,
    coalesce(card.opaque, false)
  from hits f
  join faces face on face.chat_id = f.chat_id
  left join lateral public.person_card(f.author_id, me, f.chat_id) card on true
  order by f.seq desc;
end;
$$;

-- «Недавние» лежат на телефоне снимками — с именем на момент тапа.
-- Перепроверка отдаёт человека и автора сообщения такими, какими они видны
-- сейчас: скрывший имя после того, как его нашли, в «Недавних» — псевдонимом.
drop function public.recheck_recent_searches(uuid[], uuid[]);

create function public.recheck_recent_searches(person_ids uuid[], message_ids uuid[])
returns table (
  kind text,
  id uuid,
  created_at timestamptz,
  display_name text,
  username text,
  avatar_url text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if coalesce(cardinality(person_ids), 0) > 50 or coalesce(cardinality(message_ids), 0) > 50 then
    raise exception 'Слишком много за раз' using errcode = '22023';
  end if;

  return query
  select 'person'::text, p.id, null::timestamptz, card.display_name, card.username, card.avatar_url
  from public.profiles p
  cross join lateral public.person_card(p.id, me, null) card
  where p.id = any (coalesce(person_ids, '{}'))
    and p.deleted_at is null
    and card.id is not null
    and public.privacy_allows('account_search_visibility', p.id, me)
  union all
  select
    'message', m.id,
    case when public.chat_time_visible(m.chat_id) then m.created_at end,
    coalesce(card.display_name, 'Без имени'), null, null
  from public.messages m
  left join lateral public.person_card(m.author_id, me, m.chat_id) card on true
  where m.id = any (coalesce(message_ids, '{}'))
    and m.deleted_at is null
    and m.chat_id in (select s.chat_id from public.searchable_chat_ids() s)
    and public.message_found_by_author(m.chat_id, m.author_id, me);
end;
$$;

revoke execute on function public.recheck_recent_searches(uuid[], uuid[]) from public, anon;
grant execute on function public.recheck_recent_searches(uuid[], uuid[]) to authenticated;

-- =============================================================================
-- Рассылки
-- =============================================================================

/**
 * Люди нового сообщения для личного топика получателя: автор глазами
 * получателя и, у системной строки состава, текст с показанными ему именами.
 */
create function public.message_payload_people(m public.messages, p_viewer uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  author public.person_card := public.person_card(m.author_id, p_viewer, m.chat_id);
  payload jsonb;
begin
  payload := jsonb_build_object(
    'author_id', author.id,
    'author_name', author.display_name,
    'author_opaque', coalesce(author.opaque, false)
  );

  if m.system_event in ('member_invited', 'member_joined', 'member_left', 'member_removed', 'owner_changed') then
    payload := payload || jsonb_build_object(
      'text',
      public.member_event_text(
        m.system_event,
        author.display_name,
        (public.person_card(m.system_user_id, p_viewer, m.chat_id)).display_name
      )
    );
  end if;

  return payload;
end;
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
  preview_text text;
  posts_channel public.channels;
begin
  preview_text := public.message_preview_text(new);

  update public.chats
  set
    last_message_text = preview_text,
    last_message_author_id = new.author_id
  where id = new.chat_id;

  select * into posts_channel from public.channels where posts_chat_id = new.chat_id;

  -- Без времени: оно бывает скрыто от части слушателей, а строку клиент
  -- всё равно перечитывает из базы. Без автора: он показывается каждому
  -- по-своему и дописывается ниже для каждого получателя.
  payload := jsonb_build_object(
    'message_id', new.id,
    'chat_id', new.chat_id,
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
    -- ни текста, ни автора в нём нет.
    perform realtime.send(
      jsonb_build_object(
        'message_id', new.id,
        'chat_id', new.chat_id,
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
      perform realtime.send(
        payload || public.message_payload_people(new, member.user_id),
        'new_message',
        'user:' || member.user_id::text,
        true
      );
    end loop;

    if posts_channel.id is not null then
      for member in
        select subscriber_id, notify from public.subscriptions
        where channel_id = posts_channel.id and in_chats
          and subscriber_id is distinct from new.author_id
      loop
        perform realtime.send(
          payload || public.message_payload_people(new, member.subscriber_id)
            || jsonb_build_object('notify', member.notify),
          'new_message',
          'user:' || member.subscriber_id::text,
          true
        );
      end loop;
    elsif exists (select 1 from public.subscriptions where chat_id = new.chat_id) then
      for member in
        select subscriber_id, notify from public.subscriptions
        where chat_id = new.chat_id
      loop
        -- Подписчику, которого автор заблокировал, — только сигнал, без
        -- текста, автора и уведомления.
        if public.is_blocked_by(member.subscriber_id, new.author_id) then
          perform realtime.send(
            (payload - 'text') || jsonb_build_object(
              'notify', false,
              'chat_title', public.chat_title_for(new.chat_id, member.subscriber_id)
            ),
            'new_message',
            'user:' || member.subscriber_id::text,
            true
          );
        else
          perform realtime.send(
            payload || public.message_payload_people(new, member.subscriber_id) || jsonb_build_object(
              'notify', member.notify,
              'chat_title', public.chat_title_for(new.chat_id, member.subscriber_id)
            ),
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

/**
 * «Печатает» в общий топик чата слышит кто угодно — с настоящим id. Кто
 * подменён в своих диалогах не для всех, печатает только участникам.
 */
create or replace function public.my_typing_audience(target_chat uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  visibility text;
  dialogue_names text;
  chat_kind text;
begin
  if me is null or not exists (
    select 1 from public.chat_members where chat_id = target_chat and user_id = me
  ) then
    return 'none';
  end if;

  select s.activity_status_visibility, s.dialogue_participant_name_masking
  into visibility, dialogue_names
  from public.privacy_settings s
  where s.user_id = me;

  select c.kind into chat_kind from public.chats c where c.id = target_chat;

  if visibility = 'everyone'
    and (dialogue_names = 'everyone' or chat_kind not in ('direct', 'group'))
  then
    return 'chat';
  end if;

  if visibility in ('everyone', 'friends') and (visibility = 'everyone' or not exists (
    select 1 from public.chat_members cm
    where cm.chat_id = target_chat
      and cm.user_id <> me
      and not public.are_friends(me, cm.user_id)
  )) then
    return 'members';
  end if;

  return 'none';
end;
$$;

-- =============================================================================
-- Сигнал «люди изменились»
-- =============================================================================
--
-- Человек сменил, кому видны имя, фото или имя в диалогах, или взял другой
-- псевдоним — открытые экраны его чатов перечитывают людей. Профиль и списки
-- перечитываются сами при открытии.

create function public.on_identity_setting_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chat record;
begin
  if new.profile_identity_masking is not distinct from old.profile_identity_masking
    and new.dialogue_participant_name_masking is not distinct from old.dialogue_participant_name_masking
    and new.avatar_visibility is not distinct from old.avatar_visibility
    and new.identity_alias is not distinct from old.identity_alias
  then
    return null;
  end if;

  for chat in
    select cm.chat_id from public.chat_members cm where cm.user_id = new.user_id
  loop
    begin
      perform realtime.send(
        jsonb_build_object('chat_id', chat.chat_id),
        'people_changed',
        'chat:' || chat.chat_id::text,
        true
      );
    exception
      when others then null;
    end;
  end loop;

  return null;
end;
$$;

create trigger privacy_settings_identity_changed
  after update on public.privacy_settings
  for each row execute function public.on_identity_setting_changed();

-- =============================================================================
-- Права
-- =============================================================================

revoke execute on function public.chat_people(uuid[]) from public, anon;
revoke execute on function public.list_person_chats(uuid, integer, integer) from public, anon;
revoke execute on function public.chat_info_summary(uuid) from public, anon;
revoke execute on function public.list_chat_voices(uuid, bigint, integer) from public, anon;
revoke execute on function public.search_chat_messages(uuid, text, bigint, integer) from public, anon;
revoke execute on function public.search_messages(text, bigint, integer) from public, anon;
revoke execute on function public.inviter_name(public.chat_invites) from public, anon;
revoke execute on function public.inviter_avatar_url(public.chat_invites) from public, anon;
revoke execute on function public.person_search_candidates(text, text, boolean, boolean) from public, anon, authenticated;
revoke execute on function public.message_payload_people(public.messages, uuid) from public, anon, authenticated;
revoke execute on function public.on_identity_setting_changed() from public, anon, authenticated;

grant execute on function public.chat_people(uuid[]) to authenticated;
grant execute on function public.list_person_chats(uuid, integer, integer) to authenticated;
grant execute on function public.chat_info_summary(uuid) to authenticated;
grant execute on function public.list_chat_voices(uuid, bigint, integer) to authenticated;
grant execute on function public.search_chat_messages(uuid, text, bigint, integer) to authenticated;
grant execute on function public.search_messages(text, bigint, integer) to authenticated;
grant execute on function public.inviter_name(public.chat_invites) to authenticated;
grant execute on function public.inviter_avatar_url(public.chat_invites) to authenticated;

-- =============================================================================
-- Заявки, вступление и звонок: имя глазами получателя
-- =============================================================================
--
-- Тела — прежние, меняется только имя в рассылке и пропадают люди из общего
-- топика чата.

create or replace function public.accept_chat_invite(target_chat uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me uuid := auth.uid();
  invite public.chat_invites%rowtype;
  chat public.chats;
  member record;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  select * into invite
  from public.chat_invites
  where chat_id = target_chat and invitee_id = me
  for update;

  if not found then
    raise exception 'Заявка не найдена' using errcode = 'P0002';
  end if;

  select * into chat from public.chats where id = target_chat and deleted_at is null for update;

  if chat.id is null then
    raise exception 'Чат не найден' using errcode = 'P0002';
  end if;

  if invite.status = 'accepted' then
    return;
  end if;

  if public.blocked_pair(me, invite.inviter_id) then
    raise exception 'Пользователь недоступен' using errcode = 'OPN08';
  end if;

  if chat.request_pending then
    perform public.open_dialogue_request(target_chat, me);
  else
    update public.chat_invites
    set status = 'accepted', accepted_at = now()
    where id = invite.id;

    insert into public.chat_members (chat_id, user_id)
    values (target_chat, me)
    on conflict (chat_id, user_id) do nothing;
  end if;

  if chat.kind = 'group' then
    perform public.post_member_event(target_chat, 'member_joined', me);

    -- Группа осталась без участников, пока заявка ждала, — принявший
    -- становится её владельцем.
    update public.chats set owner_id = me where id = target_chat and owner_id is null;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object('chat_id', target_chat),
      'member_joined',
      'chat:' || target_chat::text,
      true
    );

    for member in
      select user_id from public.chat_members where chat_id = target_chat and user_id <> me
    loop
      perform realtime.send(
        jsonb_build_object(
          'chat_id', target_chat,
          'user_id', me,
          'user_name', (public.person_card(me, member.user_id, target_chat)).display_name
        ),
        'member_joined',
        'user:' || member.user_id::text,
        true
      );
    end loop;

    perform realtime.send(
      jsonb_build_object('chat_id', target_chat),
      'invite_changed',
      'user:' || me::text,
      true
    );
  exception
    when others then null;
  end;
end;
$function$;

create or replace function public.invite_to_chat(target_chat uuid, invitee_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me uuid := auth.uid();
  chat public.chats;
  wanted uuid[];
  fresh uuid[];
  strangers uuid[];
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

  begin
    foreach invitee in array fresh loop
      perform realtime.send(
        jsonb_build_object(
          'chat_id', target_chat,
          'inviter_id', me,
          'inviter_name', (public.person_card(me, invitee, null)).display_name,
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
$function$;

create or replace function public.create_chat(invitee_ids uuid[], chat_title text DEFAULT NULL::text, chat_avatar_url text DEFAULT NULL::text, request_text text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me uuid := auth.uid();
  invitees uuid[];
  member_set uuid[];
  existing_chat uuid;
  pending_mine public.chats;
  new_chat uuid;
  clean_title text := nullif(btrim(chat_title), '');
  clean_avatar text;
  clean_text text := nullif(btrim(coalesce(request_text, '')), '');
  invitee uuid;
  is_direct boolean;
  peer uuid;
  strangers uuid[];
  is_request boolean;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if invitee_ids is null or cardinality(invitee_ids) = 0 or array_position(invitee_ids, null) is not null then
    raise exception 'Выберите, кого позвать' using errcode = '22023';
  end if;

  select array_agg(distinct x order by x) into invitees from unnest(invitee_ids) as x;

  if me = any (invitees) then
    raise exception 'Нельзя позвать самого себя' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles where id = me and deleted_at is null) then
    raise exception 'Профиль удалён' using errcode = '42501';
  end if;

  if (select count(*) from public.profiles where id = any (invitees) and deleted_at is null)
    <> cardinality(invitees) then
    raise exception 'Пользователь не найден' using errcode = '22023';
  end if;

  is_direct := cardinality(invitees) = 1;

  if not is_direct then
    clean_avatar := public.clean_group_avatar_url(chat_avatar_url);
  end if;

  if exists (select 1 from unnest(invitees) as x where public.blocked_pair(me, x)) then
    raise exception 'Пользователь недоступен' using errcode = 'OPN08';
  end if;

  select coalesce(array_agg(x order by x), '{}') into strangers
  from unnest(invitees) as x
  where not public.are_friends(me, x);

  peer := case when is_direct then invitees[1] end;
  is_request := is_direct and cardinality(strangers) > 0;

  select array_agg(x order by x) into member_set from unnest(invitees || me) as x;

  -- Два одновременных нажатия (или встречные создания с обеих сторон) иначе
  -- оба не нашли бы существующего чата и создали по своему.
  perform pg_advisory_xact_lock(hashtextextended('chat_set:' || array_to_string(member_set, ','), 0));

  select c.id into existing_chat
  from public.chats c
  join public.chat_invites i on i.chat_id = c.id and i.invitee_id = me and i.status <> 'accepted'
  where c.founding_member_ids = member_set
    and c.deleted_at is null
  order by i.created_at desc
  limit 1;

  if existing_chat is not null then
    return jsonb_build_object('chat_id', existing_chat, 'outcome', 'incoming_invite');
  end if;

  select c.* into pending_mine
  from public.chats c
  where c.created_by = me
    and c.founding_member_ids = member_set
    and c.deleted_at is null
    and exists (
      select 1 from public.chat_invites i where i.chat_id = c.id and i.status <> 'accepted'
    )
  limit 1;

  if pending_mine.id is not null then
    -- Моя заявка ещё висит, а мы тем временем подружились: другу пишут
    -- сразу — заявка становится обычной личкой.
    if is_direct and not is_request and pending_mine.request_pending then
      perform public.open_dialogue_request(pending_mine.id, peer);

      return jsonb_build_object('chat_id', pending_mine.id, 'outcome', 'created');
    end if;

    raise exception 'Вы уже позвали этих людей, и ответили ещё не все'
      using errcode = 'OPN01', detail = pending_mine.id::text;
  end if;

  if cardinality(strangers) > 0 then
    perform public.require_not_restricted(me);
  end if;

  if is_request then
    perform public.check_dialogue_retry(me, peer);
  end if;

  perform public.check_contact_request_limit(me, cardinality(strangers));

  if is_request and clean_text is null then
    return jsonb_build_object('chat_id', null, 'outcome', 'request_needed');
  end if;

  insert into public.chats (kind, title, avatar_url, created_by, founding_member_ids, request_pending)
  values (
    case when is_direct then 'direct' else 'group' end,
    clean_title,
    clean_avatar,
    me,
    member_set,
    is_request
  )
  returning id into new_chat;

  insert into public.chat_members (chat_id, user_id) values (new_chat, me);

  if is_direct and not is_request then
    insert into public.chat_members (chat_id, user_id) values (new_chat, peer);
  else
    insert into public.chat_invites (chat_id, inviter_id, invitee_id)
    select new_chat, me, x from unnest(invitees) as x;
  end if;

  if cardinality(strangers) > 0 then
    insert into public.contact_request_log (requester_id, kind)
    select me, case when is_direct then 'dialogue' else 'group_invite' end
    from unnest(strangers);
  end if;

  if is_request then
    insert into public.dialogue_requests (chat_id, requester_id, addressee_id)
    values (new_chat, me, peer);
  end if;

  -- Текст заявки — первое сообщение. Другу текст тоже можно передать: он
  -- просто становится первым сообщением диалога.
  if is_direct and clean_text is not null then
    insert into public.messages (chat_id, author_id, kind, text)
    values (new_chat, me, 'text', clean_text);
  end if;

  if is_direct and not is_request then
    perform public.notify_chat_changed(new_chat);
  else
    -- Заявка обязана сохраниться, даже если Realtime недоступен.
    begin
      foreach invitee in array invitees loop
        perform realtime.send(
          jsonb_build_object(
            'chat_id', new_chat,
            'inviter_id', me,
            'inviter_name', (public.person_card(me, invitee, null)).display_name,
            'chat_title', clean_title
          ),
          'invite',
          'user:' || invitee::text,
          true
        );
      end loop;
    exception
      when others then null;
    end;
  end if;

  return jsonb_build_object('chat_id', new_chat, 'outcome', 'created');
end;
$function$;

create or replace function public.start_call(target_chat uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller uuid := auth.uid();
  chat public.chats;
  existing uuid;
  new_stream uuid := gen_random_uuid();
  member record;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Строка чата под замком: второе одновременное нажатие ждёт здесь и дальше
  -- видит уже созданный звонок.
  select * into chat from public.chats where id = target_chat for update;

  if chat.id is null or chat.deleted_at is not null then
    raise exception 'chat not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.chat_members where chat_id = target_chat and user_id = caller
  ) then
    raise exception 'only chat members can start a call' using errcode = '42501';
  end if;

  select id into existing from public.streams where chat_id = target_chat and status = 'live';

  if existing is not null then
    return jsonb_build_object('stream_id', existing, 'created', false);
  end if;

  insert into public.streams (id, chat_id, host_id, room_name)
  values (new_stream, target_chat, caller, 'stream-' || new_stream::text);

  insert into public.messages (chat_id, author_id, kind, text, stream_id, system_event)
  values (target_chat, caller, 'system', 'Звонок начат', new_stream, 'call_started');

  -- Входящий — участникам чата, кроме начавшего. Приглашённый, но не
  -- принявший заявку, участником не считается.
  begin
    for member in
      select user_id from public.chat_members
      where chat_id = target_chat and user_id <> caller
    loop
      perform realtime.send(
        jsonb_build_object(
          'stream_id', new_stream,
          'chat_id', target_chat,
          'chat_title', chat.title,
          'chat_kind', chat.kind,
          'host_id', caller,
          'host_name', (public.person_card(caller, member.user_id, target_chat)).display_name,
          'started_at', now()
        ),
        'incoming_call',
        'user:' || member.user_id::text,
        true
      );
    end loop;
  exception
    when others then null;
  end;

  return jsonb_build_object('stream_id', new_stream, 'created', true);
end;
$function$;

create or replace function public.broadcast_read_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.last_read_at is not distinct from old.last_read_at then
    return new;
  end if;

  if (select time_restricted from public.chats where id = new.chat_id) then
    return new;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object('chat_id', new.chat_id),
      'read',
      'chat:' || new.chat_id::text,
      true
    );
  exception
    when others then null;
  end;

  return new;
end;
$function$;
