-- Аватарка группы в поиске: строка группы в блоках «Чаты» и «Глобальный
-- поиск» и строка сообщения из группы (`search_messages` берёт лицо чата из
-- `searchable_chats`) показывают фото группы. Тела функций — как в
-- 20261016100000_search.sql, меняется только выбор аватарки.

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
  subscribers_count int
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
      else public.outsider_chat_title(c.id)
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
    select p.id, p.display_name, p.username, p.avatar_url
    from (
      select cm.user_id as person, 0 as rank, cm.joined_at as at
      from public.chat_members cm
      where cm.chat_id = c.id and cm.user_id <> auth.uid()
      union all
      select i.invitee_id, 1, i.created_at
      from public.chat_invites i
      where i.chat_id = c.id and i.status <> 'accepted' and i.invitee_id <> auth.uid()
    ) other
    join public.profiles p on p.id = other.person and p.deleted_at is null
    order by other.rank, other.at
    limit 1
  ) peer on c.kind = 'direct' and member.chat_id is not null
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
stable
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
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  select * into q from public.search_parse(query);

  if q.text_query = '' then
    return;
  end if;

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
    where q.kind is null or m.entity_kind = q.kind
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
    else least(greatest(coalesce(global_limit, 20), 1), 100)
  end
  order by o.section desc, o.position;
end;
$$;
