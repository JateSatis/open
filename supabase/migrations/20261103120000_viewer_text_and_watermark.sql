-- Текст и водораздел глазами смотрящего — во всех местах, где сообщение
-- уходит наружу.
--
-- Участник чата видит оригинал и всё сразу. Остальные — текст для зрителей
-- (`public_text`, скрытое замазано) и только сообщения ниже водораздела
-- (`chat_public_hold`), время — время публикации, а не создания.
--
-- * `message_rows` — текст, время, правка, прочтение, `hidden_ranges`,
--   неопубликованного нет; политики `messages`, `message_pins`,
--   `forward_items` — неопубликованного нет (островок в другом чате — глазами
--   водораздела исходного чата).
-- * Превью и порядок «Чатов» (`chat_preview_for`, `last_message_at`,
--   `my_chat_list`, `chat_row_people`, непрочитанное подписок) — последнее
--   видимое смотрящему сообщение. `chats.last_message_text` хранит превью
--   для зрителей.
-- * Поиск: участник — по оригиналу, остальные — по `public_text` и только
--   опубликованное.
-- * Рассылки: участникам — сразу и с оригиналом (`user:<id>`, сигнал — в
--   `chat-members:<id>`, пока сообщение не опубликовано); подписчикам и
--   приглашённым — текст для зрителей и в момент публикации. Публикацию
--   отслеживает `release_public_messages` (pg_cron каждые 15 секунд) и
--   проверка при каждой отправке и удалении.
-- * Сигналы о неопубликованном (реакции, комментарии, правки, удаления,
--   закрепы, просмотры, кластеры, фрагменты, островки, прочтение) — только в
--   `chat-members:<id>`.
-- * «Печатает» в чате, где у кого-то из участников включена задержка, —
--   только участникам.

-- =============================================================================
-- Превью сообщения
-- =============================================================================

/**
 * Превью сообщения: участнику — с оригиналом, остальным — с замазанным
 * скрытым. Одноаргументная — превью для зрителей: его хранит
 * `chats.last_message_text`.
 */
create or replace function public.message_preview_text(m public.messages, p_member boolean)
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
  body text := public.message_seen_text(m.text, m.public_text, p_member);
begin
  if m.stream_id is not null then
    return '📞 Звонок';
  end if;

  if m.system_event in ('member_invited', 'member_joined', 'member_left', 'member_removed', 'owner_changed') then
    return public.member_event_text(
      m.system_event,
      (select display_name from public.profiles where id = m.author_id),
      (select display_name from public.profiles where id = m.system_user_id)
    );
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
    return '🎬 Pop' || coalesce(': ' || body, '');
  end if;

  if body is not null then
    return body;
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

  return body;
end;
$$;

create or replace function public.message_preview_text(m public.messages)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.message_preview_text(m, false)
$$;

revoke execute on function public.message_preview_text(public.messages, boolean) from public, anon, authenticated;

-- =============================================================================
-- Сообщения глазами смотрящего
-- =============================================================================

create or replace view public.message_rows as
select
  m.id,
  m.chat_id,
  p.author_id,
  m.kind,
  case
    when h.hidden then null
    -- В тексте системной строки состава — имена: собрать заново с показанными.
    when m.system_event in ('member_invited', 'member_joined', 'member_left', 'member_removed', 'owner_changed')
      then public.member_event_text(m.system_event, p.author_name, p.subject_name)
    else public.message_seen_text(m.text, m.public_text, s.member)
  end as text,
  m.seq,
  -- Зрителю — время публикации: настоящее выдавало бы задержку и тех, кто
  -- писал после.
  case when t.visible then case when s.member then m.created_at else m.public_at end end as created_at,
  -- Правка до публикации зрителю не видна: для него сообщение такое с самого начала.
  case when t.visible and not h.hidden and (s.member or m.edited_at > m.public_at) then m.edited_at end as edited_at,
  m.edited_at is not null and not h.hidden and (s.member or m.edited_at > m.public_at) as edited,
  case
    when m.edited_at is not null and not h.hidden and (s.member or m.edited_at > m.public_at)
      then public.message_edit_count(m.id)
  end as edit_mark,
  case
    when not t.reads or m.read_at is null then null
    when s.member then m.read_at
    else greatest(m.read_at, m.public_at)
  end as read_at,
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
  m.stream_id,
  m.system_event,
  p.subject_id as system_user_id,
  m.source_chat_id,
  m.forwarded_comment_id,
  t.visible as time_visible,
  t.reads as reads_visible,
  h.hidden,
  p.author_name,
  p.author_avatar_url,
  p.author_opaque,
  p.subject_name as system_user_name,
  p.subject_opaque as system_user_opaque,
  case when m.stream_id is not null then public.message_stream_host(m.id) end as stream_host_id,
  -- Скрытое автором: участнику — где пометка, зрителю — где замазка.
  case when h.hidden then '[]'::jsonb else public.hidden_ranges_json(m.hidden_ranges) end as hidden_ranges
from public.messages m
cross join lateral public.message_seen(m.id) s
cross join lateral public.chat_visibility(m.chat_id) t
cross join lateral (
  select case
    when m.author_id = any ((select public.my_blockers())::uuid[]) and m.kind <> 'system'
      then not public.blocker_message_visible(m.chat_id)
    else false
  end as hidden
) h
cross join lateral public.message_people(m.id) p
where m.deleted_at is null
  and public.chat_readable(m.chat_id)
  and s.seen;

-- Прямой SELECT — те же строки: неопубликованного зрителю нет даже номером.
drop policy "messages are readable by authenticated users" on public.messages;

create policy "messages are readable by authenticated users"
  on public.messages for select
  to authenticated
  using (
    deleted_at is null
    and public.chat_readable(chat_id)
    and case
      when author_id = any ((select public.my_blockers())::uuid[]) and kind <> 'system'
        then public.blocker_message_visible(chat_id)
      else true
    end
    and (select s.seen from public.message_seen(id) s)
  );

drop policy "message_pins are readable by authenticated users" on public.message_pins;

create policy "message_pins are readable by authenticated users"
  on public.message_pins for select
  to authenticated
  using (deleted_at is null and (select s.seen from public.message_seen(message_id) s));

drop policy "forward_items are readable by authenticated users" on public.forward_items;

create policy "forward_items are readable by authenticated users"
  on public.forward_items for select
  to authenticated
  using (deleted_at is null and (select s.seen from public.message_seen(message_id) s));

-- =============================================================================
-- «Чаты»: превью, время, порядок
-- =============================================================================

/** Последнее живое сообщение чата, которое видит смотрящий. */
create or replace function public.chat_last_seen_message(p_chat uuid, p_viewer uuid)
returns public.messages
language sql
stable
security definer
set search_path = public
as $$
  select m.*
  from public.chat_seen(p_chat, p_viewer) s
  join public.messages m on m.chat_id = p_chat
  where m.deleted_at is null
    and (s.hold is null or m.seq < s.hold)
  order by m.seq desc
  limit 1
$$;

revoke execute on function public.chat_last_seen_message(uuid, uuid) from public, anon, authenticated;

create or replace function public.chat_preview_for(p_chat uuid, p_viewer uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.chats;
  seen record;
  last public.messages;
begin
  select * into c from public.chats where id = p_chat;

  if c.id is null then
    return null;
  end if;

  select * into seen from public.chat_seen(p_chat, p_viewer);
  last := public.chat_last_seen_message(p_chat, p_viewer);

  if last.id is null then
    return null;
  end if;

  if c.kind <> 'channel_posts'
    and not seen.member
    and public.is_blocked_by(p_viewer, last.author_id)
  then
    return 'Сообщение скрыто';
  end if;

  if last.system_event in ('member_invited', 'member_joined', 'member_left', 'member_removed', 'owner_changed') then
    return public.member_event_text(
      last.system_event,
      (public.person_card(last.author_id, p_viewer, p_chat)).display_name,
      (public.person_card(last.system_user_id, p_viewer, p_chat)).display_name
    );
  end if;

  return public.message_preview_text(last, seen.member);
end;
$$;

create or replace function public.last_message_preview(public.chats)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.chat_preview_for($1.id, auth.uid())
$$;

create or replace function public.chat_last_message_time(p_chat uuid, p_viewer uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select case when s.member then l.created_at else l.public_at end
  from public.chat_seen(p_chat, p_viewer) s
  cross join lateral public.chat_last_seen_message(p_chat, p_viewer) l
  where public.chat_time_visible(p_chat)
$$;

revoke execute on function public.chat_last_message_time(uuid, uuid) from public, anon, authenticated;

create or replace function public.last_message_at(public.chat_rows)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select public.chat_last_message_time($1.id, auth.uid())
$$;

create or replace function public.last_message_at(public.chats)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select public.chat_last_message_time($1.id, auth.uid())
$$;

create or replace function public.chat_row_people(p_chat uuid)
returns table (owner_id uuid, created_by uuid, last_message_author_id uuid)
language plpgsql
stable
security definer
rows 1
set search_path = public
as $$
declare
  c record;
  me uuid := auth.uid();
begin
  select x.owner_id, x.created_by into c
  from public.chats x
  where x.id = p_chat and public.chat_readable(x.id);

  owner_id := public.person_shown_id(c.owner_id, me, p_chat);
  created_by := public.person_shown_id(c.created_by, me, p_chat);
  -- Автор последнего видимого: неопубликованное не выдаёт и автором.
  last_message_author_id := public.person_shown_id(
    (public.chat_last_seen_message(p_chat, me)).author_id, me, p_chat
  );
  return next;
end;
$$;

create or replace function public.my_chat_list()
returns table (chat_id uuid, entered_at timestamptz, "position" integer, has_unread boolean)
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

  return query
  with mine as (
    select cm.chat_id, cm.joined_at as entered, cm.last_read_at, true as member
    from public.chat_members cm
    where cm.user_id = me
    union all
    select coalesce(s.chat_id, ch.posts_chat_id), s.in_chats_at, null, false
    from public.subscriptions s
    left join public.channels ch on ch.id = s.channel_id
    where s.subscriber_id = me
      and (s.chat_id is not null or s.in_chats)
  ),
  deduped as (
    select distinct on (m.chat_id) m.*
    from mine m
    where m.chat_id is not null
    order by m.chat_id, m.member desc
  ),
  facts as (
    select
      d.chat_id,
      d.entered,
      d.member,
      d.last_read_at,
      last.created_at as last_at,
      last.author_id as last_author,
      ch.last_pop_at
    from deduped d
    join public.chats c on c.id = d.chat_id and c.deleted_at is null
    left join public.channels ch on ch.posts_chat_id = c.id
    left join lateral (
      -- Подписчику — последнее опубликованное и время публикации: порядок
      -- «Чатов» не выдаёт неопубликованного.
      select case when d.member then m.created_at else m.public_at end as created_at, m.author_id
      from public.messages m
      where m.chat_id = d.chat_id and m.deleted_at is null
        and (d.member or m.seq < coalesce(public.chat_public_hold(d.chat_id), 9223372036854775807))
      order by m.seq desc
      limit 1
    ) last on true
  )
  select
    f.chat_id,
    case when public.chat_time_visible(f.chat_id) then f.entered end,
    (row_number() over (
      order by greatest(f.last_at, f.last_pop_at, f.entered) desc nulls last, f.chat_id
    ) - 1)::int,
    f.member and f.last_at is not null and f.last_author is distinct from me
      and f.last_at > coalesce(f.last_read_at, '-infinity'::timestamptz)
  from facts f;
end;
$$;

create or replace function public.subscription_unread_messages(target_chat uuid, since timestamptz, viewer uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from (
    select 1
    from public.messages m
    where m.chat_id = target_chat
      and m.deleted_at is null
      and m.public_at > since
      and m.seq < coalesce(public.chat_public_hold(target_chat), 9223372036854775807)
      and m.author_id is distinct from viewer
      and m.kind <> 'system'
      and not exists (
        select 1
        from public.attachments a
        join public.pop_views v on v.pop_id = a.pop_id and v.viewer_id = viewer
        where a.message_id = m.id
      )
    limit 100
  ) unread
$$;

-- =============================================================================
-- Поиск
-- =============================================================================

create or replace function public.search_messages(
  query text,
  before_seq bigint default null,
  page_size integer default 30
)
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
set pg_trgm.word_similarity_threshold = '0.45'
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
  member_ids uuid[];
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
  -- Участнику — оригинал и всё сразу; в остальных чатах — текст для
  -- зрителей и только опубликованное.
  member_ids := array(
    select cm.chat_id from public.chat_members cm
    where cm.user_id = me and cm.chat_id = any (chat_ids)
  );
  -- Где автор не важен: мои чаты и чаты постов каналов.
  open_ids := array(
    select c.id from public.chats c
    where c.id = any (chat_ids)
      and (c.kind = 'channel_posts' or c.id = any (member_ids))
  );

  if char_length(needle) >= 4 and not exists (
    select 1 from public.messages m
    where m.deleted_at is null and m.kind in ('text', 'media') and m.text is not null
      and m.chat_id = any (chat_ids)
      and (
        (
          m.chat_id = any (member_ids)
          and (
            (tsq is not null and public.search_tsv(m.text) @@ tsq)
            or (use_like and public.search_norm(m.text) like pattern)
          )
        )
        or (
          not (m.chat_id = any (member_ids))
          and m.public_text is not null
          and (
            (tsq is not null and public.search_tsv(m.public_text) @@ tsq)
            or (use_like and public.search_norm(m.public_text) like pattern)
          )
          and public.message_seq_seen(m.chat_id, m.seq, null)
        )
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
    select
      m.id,
      m.chat_id,
      m.author_id,
      public.message_seen_text(m.text, m.public_text, m.chat_id = any (member_ids)) as text,
      m.seq,
      case when m.chat_id = any (member_ids) then m.created_at else m.public_at end as created_at
    from public.messages m
    where m.deleted_at is null and m.kind in ('text', 'media') and m.text is not null
      and m.chat_id = any (chat_ids)
      and (before_seq is null or m.seq < before_seq)
      and case
        when m.chat_id = any (member_ids) then
          case
            when use_fuzzy then needle <% public.search_norm(m.text)
            else (tsq is not null and public.search_tsv(m.text) @@ tsq)
              or (use_like and public.search_norm(m.text) like pattern)
          end
        else
          m.public_text is not null
          and case
            when use_fuzzy then needle <% public.search_norm(m.public_text)
            else (tsq is not null and public.search_tsv(m.public_text) @@ tsq)
              or (use_like and public.search_norm(m.public_text) like pattern)
          end
          and public.message_seq_seen(m.chat_id, m.seq, null)
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

create or replace function public.search_chat_messages(
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
  member boolean;
  hold bigint;
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
    exists (select 1 from public.chat_members cm where cm.chat_id = c.id and cm.user_id = me),
    c.kind = 'channel_posts'
  into member, open_chat
  from public.chats c
  where c.id = target_chat and c.deleted_at is null
    -- Непринятую заявку на диалог видят только двое — и в поиске тоже.
    and (not c.request_pending or me = any (c.founding_member_ids));

  if member is null then
    return;
  end if;

  open_chat := open_chat or member;
  hold := case when member then null else public.chat_public_hold(target_chat) end;
  tsq := public.search_tsquery(needle);
  pattern := public.search_like(needle);
  use_like := char_length(needle) >= 3;
  visible := public.chat_time_visible(target_chat);

  if member then
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
    order by m.seq desc
    limit lim;
  else
    return query
    select
      m.id, m.seq, card.id, card.display_name, m.public_text,
      case when visible then m.public_at end,
      coalesce(card.opaque, false)
    from public.messages m
    left join lateral public.person_card(m.author_id, me, m.chat_id) card on true
    where m.chat_id = target_chat
      and m.deleted_at is null and m.kind in ('text', 'media') and m.public_text is not null
      and (before_seq is null or m.seq < before_seq)
      and (hold is null or m.seq < hold)
      and (
        (tsq is not null and public.search_tsv(m.public_text) @@ tsq)
        or (use_like and public.search_norm(m.public_text) like pattern)
      )
      and (open_chat or public.message_found_by_author(m.chat_id, m.author_id, me))
    order by m.seq desc
    limit lim;
  end if;
end;
$$;

create or replace function public.count_chat_search(target_chat uuid, query text)
returns integer
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  me uuid := auth.uid();
  needle text;
  tsq tsquery;
  pattern text;
  use_like boolean;
  open_chat boolean;
  member boolean;
  hold bigint;
  total int;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  needle := public.search_norm(query);

  if needle is null or needle = '' then
    return 0;
  end if;

  select
    exists (select 1 from public.chat_members cm where cm.chat_id = c.id and cm.user_id = me),
    c.kind = 'channel_posts'
  into member, open_chat
  from public.chats c
  where c.id = target_chat and c.deleted_at is null
    -- Непринятую заявку на диалог видят только двое — и в поиске тоже.
    and (not c.request_pending or me = any (c.founding_member_ids));

  if member is null then
    return 0;
  end if;

  open_chat := open_chat or member;
  hold := case when member then null else public.chat_public_hold(target_chat) end;
  tsq := public.search_tsquery(needle);
  pattern := public.search_like(needle);
  use_like := char_length(needle) >= 3;

  if member then
    select count(*) into total
    from (
      select 1
      from public.messages m
      where m.chat_id = target_chat
        and m.deleted_at is null and m.kind in ('text', 'media') and m.text is not null
        and (
          (tsq is not null and public.search_tsv(m.text) @@ tsq)
          or (use_like and public.search_norm(m.text) like pattern)
        )
      limit 1000
    ) hits;
  else
    select count(*) into total
    from (
      select 1
      from public.messages m
      where m.chat_id = target_chat
        and m.deleted_at is null and m.kind in ('text', 'media') and m.public_text is not null
        and (hold is null or m.seq < hold)
        and (
          (tsq is not null and public.search_tsv(m.public_text) @@ tsq)
          or (use_like and public.search_norm(m.public_text) like pattern)
        )
        and (open_chat or public.message_found_by_author(m.chat_id, m.author_id, me))
      limit 1000
    ) hits;
  end if;

  return total;
end;
$$;

-- =============================================================================
-- Рассылка нового сообщения и публикация для зрителей
-- =============================================================================

/**
 * Сообщение стало видно зрителям: подписчикам чата или канала — карточка с
 * текстом для зрителей, приглашённым — «в чате что-то происходит», общему
 * топику — сигнал «перечитай» (если `signal_chat`).
 */
create or replace function public.publish_message_to_viewers(m public.messages, signal_chat boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
  member record;
  posts_channel public.channels;
begin
  select * into posts_channel from public.channels where posts_chat_id = m.chat_id;

  payload := jsonb_build_object(
    'message_id', m.id,
    'chat_id', m.chat_id,
    'kind', m.kind,
    'text', public.message_preview_text(m, false)
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
    if signal_chat then
      -- Топик чата слушает кто угодно, а клиенту он лишь сигнал «перечитай»:
      -- ни текста, ни автора в нём нет.
      perform realtime.send(
        jsonb_build_object('message_id', m.id, 'chat_id', m.chat_id, 'kind', m.kind),
        'new_message',
        'chat:' || m.chat_id::text,
        true
      );
    end if;

    if posts_channel.id is not null then
      for member in
        select subscriber_id, notify from public.subscriptions
        where channel_id = posts_channel.id and in_chats
          and subscriber_id is distinct from m.author_id
      loop
        perform realtime.send(
          payload || public.message_payload_people(m, member.subscriber_id)
            || jsonb_build_object('notify', member.notify),
          'new_message',
          'user:' || member.subscriber_id::text,
          true
        );
      end loop;
    elsif exists (select 1 from public.subscriptions where chat_id = m.chat_id) then
      for member in
        select subscriber_id, notify from public.subscriptions
        where chat_id = m.chat_id
          -- Подписчик, ставший участником, получил сообщение как участник.
          and not exists (
            select 1 from public.chat_members cm
            where cm.chat_id = m.chat_id and cm.user_id = subscriber_id
          )
      loop
        -- Подписчику, которого автор заблокировал, — только сигнал, без
        -- текста, автора и уведомления.
        if public.is_blocked_by(member.subscriber_id, m.author_id) then
          perform realtime.send(
            (payload - 'text') || jsonb_build_object(
              'notify', false,
              'chat_title', public.chat_title_for(m.chat_id, member.subscriber_id)
            ),
            'new_message',
            'user:' || member.subscriber_id::text,
            true
          );
        else
          perform realtime.send(
            payload || public.message_payload_people(m, member.subscriber_id) || jsonb_build_object(
              'notify', member.notify,
              'chat_title', public.chat_title_for(m.chat_id, member.subscriber_id)
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
      where chat_id = m.chat_id and status = 'pending' and invitee_id is not null
    loop
      perform realtime.send(
        jsonb_build_object('chat_id', m.chat_id),
        'invite_activity',
        'user:' || member.user_id::text,
        true
      );
    end loop;
  exception
    when others then null;
  end;
end;
$$;

revoke execute on function public.publish_message_to_viewers(public.messages, boolean) from public, anon, authenticated;

/**
 * Сдвинуть водораздел чата до текущего и разослать зрителям всё, что под
 * ним оказалось: по карточке на сообщение (не больше 50 за раз) и по одному
 * сигналу «перечитай» сообщения, закрепы и прочтение в общий топик.
 */
create or replace function public.release_chat_messages(p_chat uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  stored bigint;
  current_hold bigint;
  released public.messages;
  any_released boolean := false;
begin
  select c.public_hold_seq into stored from public.chats c where c.id = p_chat for update;

  current_hold := public.chat_public_hold(p_chat);

  if stored is not distinct from current_hold then
    return;
  end if;

  update public.chats set public_hold_seq = current_hold where id = p_chat;

  if stored is null then
    return;
  end if;

  for released in
    select * from public.messages m
    where m.chat_id = p_chat
      and m.deleted_at is null
      and m.seq >= stored
      and (current_hold is null or m.seq < current_hold)
    order by m.seq
    limit 50
  loop
    any_released := true;
    perform public.publish_message_to_viewers(released, false);
  end loop;

  if any_released then
    begin
      perform realtime.send(jsonb_build_object('chat_id', p_chat), 'new_message', 'chat:' || p_chat::text, true);
      perform realtime.send(jsonb_build_object('chat_id', p_chat), 'pins_changed', 'chat:' || p_chat::text, true);
      perform realtime.send(jsonb_build_object('chat_id', p_chat), 'read', 'chat:' || p_chat::text, true);
    exception
      when others then null;
    end;
  end if;
end;
$$;

revoke execute on function public.release_chat_messages(uuid) from public, anon, authenticated;

/** Задача pg_cron: опубликовать наступившее во всех чатах с водоразделом. */
create or replace function public.release_public_messages()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  chat record;
begin
  for chat in
    select c.id from public.chats c
    where c.public_hold_seq is not null
    for update skip locked
  loop
    perform public.release_chat_messages(chat.id);
  end loop;
end;
$$;

revoke execute on function public.release_public_messages() from public, anon, authenticated;

select cron.schedule('release-public-messages', '15 seconds', $$select public.release_public_messages()$$);

create or replace function public.broadcast_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member record;
  member_payload jsonb;
  stored bigint;
  published boolean;
begin
  -- Хранится превью для зрителей; участнику его собирает chat_preview_for.
  update public.chats
  set
    last_message_text = public.message_preview_text(new),
    last_message_author_id = new.author_id
  where id = new.chat_id
  returning public_hold_seq into stored;

  published := public.message_seq_seen(new.chat_id, new.seq, null);

  -- Без времени: оно бывает скрыто от части слушателей, а строку клиент
  -- всё равно перечитывает из базы. Без автора: он показывается каждому
  -- по-своему и дописывается ниже для каждого получателя.
  member_payload := jsonb_build_object(
    'message_id', new.id,
    'chat_id', new.chat_id,
    'kind', new.kind,
    'text', public.message_preview_text(new, true)
  );

  begin
    for member in
      select user_id from public.chat_members
      where chat_id = new.chat_id and user_id is distinct from new.author_id
    loop
      perform realtime.send(
        member_payload || public.message_payload_people(new, member.user_id),
        'new_message',
        'user:' || member.user_id::text,
        true
      );
    end loop;

    if not published then
      perform realtime.send(
        jsonb_build_object('message_id', new.id, 'chat_id', new.chat_id, 'kind', new.kind),
        'new_message',
        'chat-members:' || new.chat_id::text,
        true
      );
    end if;
  exception
    when others then null;
  end;

  if stored is not null or not published then
    -- Водораздел был или появился: зрителям всё — через публикацию.
    perform public.release_chat_messages(new.chat_id);
  else
    perform public.publish_message_to_viewers(new, true);
  end if;

  return new;
end;
$$;

-- =============================================================================
-- Удаление
-- =============================================================================

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
  pending record;
  running timestamptz;
  public_ids uuid[];
begin
  for affected in
    select
      n.chat_id,
      array_agg(n.id) as ids,
      max(n.seq) as newest,
      bool_or(o.public_at > now()) as had_pending
    from new_rows n
    join old_rows o on o.id = n.id
    where o.deleted_at is null and n.deleted_at is not null
    group by n.chat_id
  loop
    update public.message_pins
    set deleted_at = now()
    where (message_id = any (affected.ids) or forward_id = any (affected.ids))
      and deleted_at is null;

    -- Какие из удалённых зрители уже видели: о них — в общий топик.
    public_ids := array(
      select n.id from new_rows n
      where n.id = any (affected.ids)
        and n.public_at <= now()
        and n.seq < coalesce(public.chat_public_hold(affected.chat_id), 9223372036854775807)
    );

    -- Удалённое неопубликованное водораздел не держит: время публикации
    -- следующих за ним пересчитывается — каждое ждёт только свою задержку и
    -- живые неопубликованные перед ним.
    if affected.had_pending then
      running := now();

      for pending in
        select m.id, m.created_at, m.delayed_until, m.public_at
        from public.messages m
        where m.chat_id = affected.chat_id
          and m.deleted_at is null
          and m.public_at > m.created_at
          and m.public_at > now()
        order by m.seq
      loop
        running := greatest(running, coalesce(pending.delayed_until, pending.created_at));

        if pending.public_at <> running then
          update public.messages set public_at = running where id = pending.id;
        end if;
      end loop;
    end if;

    -- Превью меняется, только если удалили самое свежее из живых.
    preview_changed := not exists (
      select 1 from public.messages m
      where m.chat_id = affected.chat_id and m.deleted_at is null and m.seq > affected.newest
    );

    if preview_changed then
      select * into last_live
      from public.messages
      where chat_id = affected.chat_id and deleted_at is null
      order by seq desc
      limit 1;

      update public.chats
      set
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
        'chat-members:' || affected.chat_id::text,
        true
      );

      if cardinality(public_ids) > 0 then
        perform realtime.send(
          jsonb_build_object('chat_id', affected.chat_id, 'message_ids', to_jsonb(public_ids)),
          'messages_deleted',
          'chat:' || affected.chat_id::text,
          true
        );
      end if;

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

        if cardinality(public_ids) > 0 then
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
      end if;
    exception
      when others then null;
    end;

    if affected.had_pending then
      perform public.release_chat_messages(affected.chat_id);
    end if;
  end loop;

  return null;
end;
$$;

-- =============================================================================
-- «Печатает»
-- =============================================================================

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
  delayed boolean;
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

  -- Задержка у кого-то из участников: «печатает» в общем топике выдало бы
  -- переписку, которую зрители ещё не видят.
  delayed := chat_kind in ('direct', 'group') and exists (
    select 1
    from public.chat_members cm
    join public.privacy_settings s on s.user_id = cm.user_id
    where cm.chat_id = target_chat and s.public_message_visibility_delay = 'random_delay'
  );

  if visibility = 'everyone'
    and (dialogue_names = 'everyone' or chat_kind not in ('direct', 'group'))
    and not delayed
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
-- Сигналы о сообщениях: неопубликованное — только участникам
-- =============================================================================

-- count_reaction: сигнал о неопубликованном — только участникам.
CREATE OR REPLACE FUNCTION public.count_reaction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  was_active boolean := tg_op <> 'INSERT' and old.deleted_at is null;
  is_active boolean := tg_op <> 'DELETE' and new.deleted_at is null;
  kind text := coalesce(new.target_type, old.target_type);
  target uuid := coalesce(new.target_id, old.target_id);
  target_chat uuid := coalesce(new.chat_id, old.chat_id);
  comment_message uuid;
  comment_pop uuid;
  fragment_message uuid;
  fragment_cluster uuid;
  pop_channel uuid;
  old_member text;
  old_visitor text;
  new_member text;
  new_visitor text;
begin
  if was_active and is_active
     and old.emoji = new.emoji and old.audience = new.audience then
    return null;
  end if;

  if was_active then
    old_member := case when old.audience = 'member' then old.emoji end;
    old_visitor := case when old.audience = 'visitor' then old.emoji end;
  end if;

  if is_active then
    new_member := case when new.audience = 'member' then new.emoji end;
    new_visitor := case when new.audience = 'visitor' then new.emoji end;
  end if;

  if kind = 'message' then
    update public.messages
    set
      member_reactions = public.reaction_counts_add(
        public.reaction_counts_add(member_reactions, old_member, -1), new_member, 1
      ),
      visitor_reactions = public.reaction_counts_add(
        public.reaction_counts_add(visitor_reactions, old_visitor, -1), new_visitor, 1
      ),
      reactions_count = greatest(0, reactions_count - was_active::int + is_active::int)
    where id = target;
  elsif kind = 'fragment' then
    -- Кластер до обновления: уснувший фрагмент из него уйдёт, а голос надо
    -- снять с того, где он был.
    select cluster_id into fragment_cluster from public.message_fragments where id = target;

    update public.message_fragments
    set
      member_reactions = public.reaction_counts_add(
        public.reaction_counts_add(member_reactions, old_member, -1), new_member, 1
      ),
      visitor_reactions = public.reaction_counts_add(
        public.reaction_counts_add(visitor_reactions, old_visitor, -1), new_visitor, 1
      ),
      reactions_count = greatest(0, reactions_count - was_active::int + is_active::int)
    where id = target
    returning message_id into fragment_message;

    if fragment_message is not null and not public.fragment_clusters_writing() then
      if was_active <> is_active then
        perform public.fragment_cluster_vote(
          fragment_cluster, coalesce(new.user_id, old.user_id), case when is_active then 1 else -1 end
        );
      end if;

      if coalesce(current_setting('open.cluster_reaction_replaced', true), '') <> 'on' then
        perform public.fragment_clusters_touch(fragment_message, true, false);
      end if;
    end if;
  elsif kind = 'comment' then
    update public.comments
    set
      member_reactions = public.reaction_counts_add(
        public.reaction_counts_add(member_reactions, old_member, -1), new_member, 1
      ),
      visitor_reactions = public.reaction_counts_add(
        public.reaction_counts_add(visitor_reactions, old_visitor, -1), new_visitor, 1
      ),
      reactions_count = greatest(0, reactions_count - was_active::int + is_active::int)
    where id = target
    returning message_id, pop_id into comment_message, comment_pop;
  elsif kind = 'pop' then
    if was_active and is_active and old.emoji = new.emoji then
      return null;
    end if;

    update public.pops
    set
      reactions = public.reaction_counts_add(
        public.reaction_counts_add(
          reactions, case when was_active then old.emoji end, -1
        ),
        case when is_active then new.emoji end,
        1
      ),
      reactions_count = greatest(0, reactions_count - was_active::int + is_active::int)
    where id = target
    returning channel_id into pop_channel;
  else
    return null;
  end if;

  -- Payload — сигнал: счётчики клиент перечитывает из базы, пачкой.
  begin
    if kind = 'message' then
      perform realtime.send(
        jsonb_build_object('chat_id', target_chat, 'message_id', target),
        'reactions_changed',
        public.message_signal_topic(target_chat, (select x.seq from public.messages x where x.id = target)),
        true
      );
    elsif kind = 'fragment' and fragment_message is not null then
      perform realtime.send(
        jsonb_build_object('message_id', fragment_message, 'fragment_id', target),
        'fragment_reactions_changed',
        'comments:' || fragment_message::text,
        true
      );
    elsif kind = 'comment' and coalesce(comment_message, comment_pop) is not null then
      perform realtime.send(
        jsonb_build_object('message_id', comment_message, 'pop_id', comment_pop, 'comment_id', target),
        'comment_reactions_changed',
        'comments:' || coalesce(comment_message, comment_pop)::text,
        true
      );
    elsif kind = 'pop' and pop_channel is not null then
      perform realtime.send(
        jsonb_build_object('channel_id', pop_channel, 'pop_id', target),
        'pop_reactions_changed',
        'pops:' || pop_channel::text,
        true
      );
    end if;
  exception
    when others then null;
  end;

  return null;
end;
$function$;

-- handle_comment_changed: сигнал о неопубликованном — только участникам.
CREATE OR REPLACE FUNCTION public.handle_comment_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  delta int := 0;
  event text;
  target uuid := coalesce(new.message_id, new.pop_id);
  pop_channel uuid;
  fragment_cluster uuid;
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is null then
      delta := 1;
      event := 'comment_added';
    end if;
  elsif old.deleted_at is null and new.deleted_at is not null then
    delta := -1;
    event := 'comment_deleted';
  elsif old.deleted_at is not null and new.deleted_at is null then
    delta := 1;
    event := 'comment_added';
  elsif new.deleted_at is null and new.edited_at is distinct from old.edited_at then
    event := 'comment_edited';
  end if;

  if event is null then
    return null;
  end if;

  if delta <> 0 then
    if new.pop_id is not null then
      update public.pops
      set comments_count = greatest(0, comments_count + delta)
      where id = new.pop_id
      returning channel_id into pop_channel;
    else
      update public.messages
      set comments_count = greatest(0, comments_count + delta)
      where id = new.message_id;
    end if;

    if new.fragment_id is not null then
      perform public.lock_fragment_clusters_shared(new.message_id);

      select cluster_id into fragment_cluster from public.message_fragments where id = new.fragment_id;

      update public.message_fragments
      set comments_count = greatest(0, comments_count + delta)
      where id = new.fragment_id;

      if not public.fragment_clusters_writing() then
        perform public.fragment_cluster_vote(fragment_cluster, new.author_id, delta);
        perform public.fragment_clusters_touch(new.message_id, true, false);
      end if;
    end if;

    if new.thread_root_id is not null then
      update public.comments
      set replies_count = greatest(0, replies_count + delta)
      where id = new.thread_root_id;
    end if;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object(
        'message_id', new.message_id,
        'pop_id', new.pop_id,
        'comment_id', new.id,
        'thread_root_id', new.thread_root_id,
        'fragment_id', new.fragment_id
      ),
      event,
      'comments:' || target::text,
      true
    );

    if delta <> 0 and new.pop_id is not null then
      perform realtime.send(
        jsonb_build_object('channel_id', pop_channel, 'pop_id', new.pop_id),
        'pop_comments_changed',
        'pops:' || pop_channel::text,
        true
      );
    elsif delta <> 0 then
      perform realtime.send(
        jsonb_build_object('chat_id', new.chat_id, 'message_id', new.message_id),
        'comments_changed',
        public.message_signal_topic(new.chat_id, (select x.seq from public.messages x where x.id = new.message_id)),
        true
      );
    end if;
  exception
    when others then null;
  end;

  return null;
end;
$function$;

-- count_fragment: сигнал о неопубликованном — только участникам.
CREATE OR REPLACE FUNCTION public.count_fragment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  was_shown boolean := tg_op = 'UPDATE' and old.deleted_at is null and old.anchor_state <> 'lost';
  is_shown boolean := new.deleted_at is null and new.anchor_state <> 'lost';
begin
  if was_shown = is_shown then
    return null;
  end if;

  update public.messages
  set fragments_count = greatest(0, fragments_count + case when is_shown then 1 else -1 end)
  where id = new.message_id;

  begin
    perform realtime.send(
      jsonb_build_object('chat_id', new.chat_id, 'message_id', new.message_id),
      'fragments_changed',
      public.message_signal_topic(new.chat_id, (select x.seq from public.messages x where x.id = new.message_id)),
      true
    );
  exception
    when others then null;
  end;

  return null;
end;
$function$;

-- signal_cluster_look: сигнал о неопубликованном — только участникам.
CREATE OR REPLACE FUNCTION public.signal_cluster_look()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.deleted_at is not null or new.display_start is null then
    return null;
  end if;

  -- Пересчёт модели сам сигналит о новом наборе; лидер — только здесь.
  if public.fragment_clusters_writing() then
    if old.dominant_emoji is not distinct from new.dominant_emoji then
      return null;
    end if;
  elsif (old.dominant_emoji, old.reactions_count) is not distinct from (new.dominant_emoji, new.reactions_count) then
    return null;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object('chat_id', new.chat_id, 'message_id', new.message_id),
      'clusters_changed',
      public.message_signal_topic(new.chat_id, (select x.seq from public.messages x where x.id = new.message_id)),
      true
    );
  exception
    when others then null;
  end;

  return null;
end;
$function$;

-- broadcast_pins_changed: сигнал о неопубликованном — только участникам.
CREATE OR REPLACE FUNCTION public.broadcast_pins_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    perform realtime.send(
      jsonb_build_object('chat_id', new.chat_id),
      'pins_changed',
      public.message_signal_topic(new.chat_id, (select x.seq from public.messages x where x.id = new.message_id)),
      true
    );
  exception
    when others then null;
  end;

  return new;
end;
$function$;

-- broadcast_read_state: сигнал о неопубликованном — только участникам.
CREATE OR REPLACE FUNCTION public.broadcast_read_state()
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
      public.chat_signal_topic(new.chat_id),
      true
    );
  exception
    when others then null;
  end;

  return new;
end;
$function$;

-- record_message_views: сигнал о неопубликованном — только участникам.
CREATE OR REPLACE FUNCTION public.record_message_views(target_chat uuid, message_ids uuid[], session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  viewer uuid := auth.uid();
  valid uuid[];
  counted uuid[];
  read uuid[] := '{}';
  touched uuid[];
  is_member boolean;
begin
  if viewer is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if session_id is null then
    raise exception 'session is required' using errcode = '22004';
  end if;

  if coalesce(cardinality(message_ids), 0) = 0 then
    return;
  end if;

  -- Больше на одном экране за пару секунд не покажется.
  if cardinality(message_ids) > 200 then
    raise exception 'too many messages' using errcode = '22023';
  end if;

  if exists (select 1 from public.chats where id = target_chat and request_pending) then
    return;
  end if;

  select coalesce(array_agg(m.id), '{}')
  into valid
  from public.messages m
  where m.id = any (message_ids)
    and m.chat_id = target_chat
    and m.deleted_at is null
    and m.kind <> 'forward'
    and m.author_id is distinct from viewer;

  if cardinality(valid) = 0 then
    return;
  end if;

  is_member := exists (
    select 1 from public.chat_members
    where chat_id = target_chat and user_id = viewer
  );

  -- Первая строка пары — уникальный и неуникальный просмотр. Следующие —
  -- только неуникальный, если это другая сессия и прошло достаточно времени.
  with upserted as (
    insert into public.message_views as v (message_id, viewer_id, session_id, counted_at)
    select id, viewer, record_message_views.session_id, now()
    from unnest(valid) as id
    on conflict (message_id, viewer_id) do update
      set session_id = excluded.session_id,
          counted_at = excluded.counted_at
      where v.session_id <> excluded.session_id
        and v.counted_at <= now() - interval '10 seconds'
    -- xmax = 0 — строку вставили, а не обновили: первый просмотр человеком.
    returning v.message_id, (v.xmax = 0) as first_view
  ),
  bumped as (
    update public.messages m
    set views_count = m.views_count + 1,
        unique_views_count = m.unique_views_count + case when u.first_view then 1 else 0 end,
        member_views_count = m.member_views_count + case when is_member then 1 else 0 end,
        member_unique_views_count = m.member_unique_views_count
          + case when is_member and u.first_view then 1 else 0 end
    from upserted u
    where m.id = u.message_id
    returning m.id
  )
  select coalesce(array_agg(id), '{}') into counted from bumped;

  if is_member then
    with marked as (
      update public.messages
      set read_at = now()
      where id = any (valid) and read_at is null
      returning id
    )
    select coalesce(array_agg(id), '{}') into read from marked;
  end if;

  select coalesce(array_agg(distinct id), '{}')
  into touched
  from unnest(counted || read) as id;

  if cardinality(touched) = 0 then
    return;
  end if;

  -- Просмотр участника скрытого чата — это его «прочитал сейчас»: сигнал
  -- в общий топик выдал бы момент. Остальные увидят числа при перечитывании.
  if is_member and (select time_restricted from public.chats where id = target_chat) then
    return;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object('chat_id', target_chat, 'message_ids', to_jsonb(touched)),
      'views_changed',
      public.chat_signal_topic(target_chat),
      true
    );
  exception
    when others then null;
  end;
end;
$function$;

-- fragment_clusters_apply: сигнал о неопубликованном — только участникам.
CREATE OR REPLACE FUNCTION public.fragment_clusters_apply(target_message uuid, result jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  st public.fragment_cluster_state;
  m public.messages;
  cfg public.fragment_cluster_config := public.fragment_cluster_settings();
  ids bigint[] := array(select jsonb_array_elements_text(coalesce(result -> 'msg_ids', '[]'::jsonb))::bigint);
  result_version int := coalesce((result ->> 'model_version')::int, cfg.version);
  before_display text;
  after_display text;
  unattached int;
  outcome text := 'applied';
  decision_now uuid;
  shown_decision uuid;
  shown_changed boolean;
  skipped int;
begin
  perform set_config('lock_timeout', '5s', true);
  perform set_config('open.clusters_writer', 'on', true);
  perform pg_advisory_xact_lock(public.fragment_clusters_lock_key(target_message));

  select * into st from public.fragment_cluster_state where message_id = target_message;

  if st.lease_token is null or st.lease_token::text is distinct from result ->> 'lease' then
    perform pgmq.delete('fragment_clusters', ids);
    return 'lease_lost';
  end if;

  decision_now := st.decision_id;
  skipped := st.decisions_skipped;

  select * into m from public.messages where id = target_message;

  select string_agg(k.id || ':' || k.display_start || '-' || k.display_end, ',' order by k.id)
  into before_display
  from public.fragment_clusters k
  where k.message_id = target_message and k.deleted_at is null and k.display_start is not null;

  if m.id is null or m.deleted_at is not null then
    update public.message_fragments set cluster_id = null
    where message_id = target_message and cluster_id is not null;

    update public.fragment_clusters
    set deleted_at = now(), display_start = null, display_end = null, updated_at = now()
    where message_id = target_message and deleted_at is null;

    outcome := 'deleted';
  elsif coalesce(m.edited_at, m.created_at) is distinct from (result ->> 'text_version')::timestamptz
     or md5(coalesce(m.text, '')) is distinct from result ->> 'text_hash' then
    update public.fragment_cluster_state
    set lease_token = null, lease_until = null, updated_at = now()
    where message_id = target_message;

    perform public.fragment_clusters_enqueue(target_message);
    perform pgmq.delete('fragment_clusters', ids);

    return 'stale_text';
  else
    -- Строки фрагментов — первыми и по порядку: так же их берут реакции.
    perform 1 from public.message_fragments
    where message_id = target_message
    order by id
    for no key update;

    create temp table if not exists fragment_cluster_plan (
      ord int primary key,
      id uuid not null,
      inherited boolean not null,
      start_offset int not null,
      end_offset int not null,
      display_start int,
      display_end int,
      popularity double precision not null
    ) on commit drop;

    create temp table if not exists fragment_cluster_assign (
      fragment_id uuid primary key,
      ord int not null
    ) on commit drop;

    truncate fragment_cluster_plan, fragment_cluster_assign;

    insert into fragment_cluster_plan
    select
      c.ord,
      case when c.dup = 1 and k.id is not null then k.id else gen_random_uuid() end,
      c.dup = 1 and k.id is not null,
      c.start_offset,
      c.end_offset,
      c.display_start,
      c.display_end,
      c.popularity
    from (
      select
        x.ord::int as ord,
        public.uuid_or_null(x.v ->> 'id') as wanted,
        (x.v ->> 'start')::int as start_offset,
        (x.v ->> 'end')::int as end_offset,
        (x.v -> 'display' ->> 'start')::int as display_start,
        (x.v -> 'display' ->> 'end')::int as display_end,
        coalesce((x.v ->> 'popularity')::double precision, 0) as popularity,
        row_number() over (partition by public.uuid_or_null(x.v ->> 'id') order by x.ord) as dup
      from jsonb_array_elements(coalesce(result -> 'clusters', '[]'::jsonb)) with ordinality as x(v, ord)
    ) c
    left join public.fragment_clusters k
      on k.id = c.wanted and k.message_id = target_message and k.deleted_at is null;

    insert into fragment_cluster_assign (fragment_id, ord)
    select distinct on (public.uuid_or_null(f.value)) public.uuid_or_null(f.value), x.ord::int
    from jsonb_array_elements(coalesce(result -> 'clusters', '[]'::jsonb)) with ordinality as x(v, ord)
    cross join lateral jsonb_array_elements_text(coalesce(x.v -> 'fragmentIds', '[]'::jsonb)) f(value)
    where public.uuid_or_null(f.value) is not null
    order by public.uuid_or_null(f.value), x.ord;

    update public.fragment_clusters k
    set
      start_offset = p.start_offset,
      end_offset = p.end_offset,
      display_start = p.display_start,
      display_end = p.display_end,
      popularity = p.popularity,
      model_version = result_version,
      updated_at = now()
    from fragment_cluster_plan p
    where p.inherited and k.id = p.id;

    insert into public.fragment_clusters (
      id, message_id, chat_id, start_offset, end_offset, display_start, display_end, popularity, model_version
    )
    select p.id, m.id, m.chat_id, p.start_offset, p.end_offset, p.display_start, p.display_end, p.popularity, result_version
    from fragment_cluster_plan p
    where not p.inherited;

    update public.fragment_clusters k
    set deleted_at = now(), display_start = null, display_end = null, updated_at = now()
    where k.message_id = target_message
      and k.deleted_at is null
      and not exists (select 1 from fragment_cluster_plan p where p.id = k.id);

    -- Фрагменты из результата — в свои кластеры.
    update public.message_fragments f
    set cluster_id = p.id
    from fragment_cluster_assign a
    join fragment_cluster_plan p on p.ord = a.ord
    where f.id = a.fragment_id
      and f.message_id = target_message
      and f.deleted_at is null
      and f.anchor_state <> 'lost'
      and f.cluster_id is distinct from p.id;

    -- Появившиеся после снимка (и все, чей кластер погас) — по правилу
    -- нового фрагмента: в кластер с наибольшим пересечением или без кластера.
    update public.message_fragments f
    set cluster_id = (
      select k.id
      from public.fragment_clusters k
      where k.message_id = target_message
        and k.deleted_at is null
        and k.start_offset < f.end_offset
        and k.end_offset > f.start_offset
      order by
        least(k.end_offset, f.end_offset) - greatest(k.start_offset, f.start_offset) desc,
        k.created_at,
        k.id
      limit 1
    )
    where f.message_id = target_message
      and f.deleted_at is null
      and f.anchor_state <> 'lost'
      and not exists (select 1 from fragment_cluster_assign a where a.fragment_id = f.id);

    -- Спящие и потерянные не держат погасших кластеров.
    update public.message_fragments f
    set cluster_id = null
    from public.fragment_clusters k
    where f.message_id = target_message
      and f.cluster_id = k.id
      and k.deleted_at is not null;

    perform public.refresh_message_clusters(target_message);
  end if;

  select string_agg(k.id || ':' || k.display_start || '-' || k.display_end, ',' order by k.id)
  into after_display
  from public.fragment_clusters k
  where k.message_id = target_message and k.deleted_at is null and k.display_start is not null;

  -- Снимок решения: при смене отображаемого набора или раз в `decisionEvery`
  -- пересчётов — иначе журнал заполнили бы одинаковые снимки.
  if outcome = 'applied' and jsonb_typeof(result -> 'decision') = 'object' then
    shown_changed := decision_now is null or before_display is distinct from after_display;

    if shown_changed or skipped + 1 >= greatest(1, coalesce((cfg.params ->> 'decisionEvery')::int, 20)) then
      insert into public.fragment_cluster_decisions (message_id, model_version, scorer, interactions, decision, displayed)
      values (
        target_message,
        result_version,
        result -> 'decision' ->> 'scorer',
        coalesce((result ->> 'interactions')::int, 0),
        result -> 'decision',
        (
          select coalesce(jsonb_agg(jsonb_build_object(
            'cluster_id', k.id, 'start', k.display_start, 'end', k.display_end
          ) order by k.display_start), '[]'::jsonb)
          from public.fragment_clusters k
          where k.message_id = target_message and k.deleted_at is null and k.display_start is not null
        )
      )
      returning id into decision_now;

      skipped := 0;
    else
      skipped := skipped + 1;
    end if;

    -- Кластеры ссылаются на снимок, по которому показан нынешний набор.
    -- Периодический снимок с тем же набором его не подменяет: клиент о нём не
    -- узнал бы (сигнала нет — набор тот же) и слал бы события по старому id.
    if shown_changed then
      shown_decision := decision_now;
    else
      select k.decision_id into shown_decision
      from public.fragment_clusters k
      where k.message_id = target_message
        and k.deleted_at is null
        and k.display_start is not null
        and k.decision_id is not null
      limit 1;

      shown_decision := coalesce(shown_decision, decision_now);
    end if;

    update public.fragment_clusters k
    set decision_id = shown_decision
    where k.message_id = target_message
      and k.deleted_at is null
      and k.decision_id is distinct from shown_decision;
  end if;

  select count(*) into unattached
  from public.message_fragments f
  where f.message_id = target_message
    and f.deleted_at is null
    and f.anchor_state <> 'lost'
    and f.cluster_id is null;

  update public.fragment_cluster_state
  set
    lease_token = null,
    lease_until = null,
    recomputed_interactions = coalesce((result ->> 'interactions')::int, recomputed_interactions),
    model_version = result_version,
    recomputed_at = now(),
    decision_id = decision_now,
    decisions_skipped = skipped,
    updated_at = now()
  where message_id = target_message
  returning * into st;

  perform pgmq.delete('fragment_clusters', ids);

  -- Снимок сильно устарел или кто-то остался без кластера — ещё раз.
  if outcome = 'applied' and (
    unattached > 0
    or st.interactions - st.recomputed_interactions >= coalesce((cfg.params ->> 'staleInteractions')::int, 10)
  ) then
    perform public.fragment_clusters_enqueue(target_message);
  end if;

  if before_display is distinct from after_display and m.id is not null then
    begin
      perform realtime.send(
        jsonb_build_object('chat_id', m.chat_id, 'message_id', target_message),
        'clusters_changed',
        public.message_signal_topic(m.chat_id, m.seq),
        true
      );
    exception
      when others then null;
    end;
  end if;

  return outcome;
end;
$function$;

-- remove_forward_items: сигнал о неопубликованном — только участникам.
CREATE OR REPLACE FUNCTION public.remove_forward_items(target_forward uuid, message_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      public.message_signal_topic(f.chat_id, f.seq),
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
$function$;

-- =============================================================================
-- «Недавние» в поиске
-- =============================================================================

-- recheck_recent_searches: неопубликованного нет, время зрителя — время публикации.
CREATE OR REPLACE FUNCTION public.recheck_recent_searches(person_ids uuid[], message_ids uuid[], chat_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS TABLE(kind text, id uuid, created_at timestamp with time zone, display_name text, username text, avatar_url text, chat_title text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if coalesce(cardinality(person_ids), 0) > 50
    or coalesce(cardinality(message_ids), 0) > 50
    or coalesce(cardinality(chat_ids), 0) > 50
  then
    raise exception 'Слишком много за раз' using errcode = '22023';
  end if;

  return query
  select 'person'::text, p.id, null::timestamptz, card.display_name, card.username, card.avatar_url, null::text
  from public.profiles p
  cross join lateral public.person_card(p.id, me, null) card
  where p.id = any (coalesce(person_ids, '{}'))
    and p.deleted_at is null
    and card.id is not null
    and public.privacy_allows('account_search_visibility', p.id, me)
  union all
  select
    'message', m.id,
    case when public.chat_time_visible(m.chat_id) then
      case when public.am_chat_member(m.chat_id) then m.created_at else m.public_at end
    end,
    coalesce(card.display_name, 'Без имени'), null, null,
    face.title
  from public.messages m
  left join lateral public.person_card(m.author_id, me, m.chat_id) card on true
  left join lateral (
    select f.title from public.searchable_chats() f where f.chat_id = m.chat_id
  ) face on true
  where m.id = any (coalesce(message_ids, '{}'))
    and m.deleted_at is null
    and m.chat_id in (select s.chat_id from public.searchable_chat_ids() s)
    and public.message_found_by_author(m.chat_id, m.author_id, me)
    and public.message_seq_seen(m.chat_id, m.seq, me)
  union all
  -- Свои чаты и подписки: название и лицо лички — собеседник глазами смотрящего.
  select 'chat', f.chat_id, null, f.title, f.username, f.avatar_url, f.title
  from public.searchable_chats() f
  where f.chat_id = any (coalesce(chat_ids, '{}'));
end;
$function$;
