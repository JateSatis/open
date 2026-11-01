-- Треды в чатах: вид «Треды» в группах.
--
-- Ответ — сообщение хотя бы с одной цитатой на сообщение этого чата (не на
-- оригинал из островка). Исходное сообщение треда — сообщение без таких
-- цитат, на которое кто-то ответил. Тред исходного — все ответы на него,
-- ответы на эти ответы и так вглубь; ответ с цитатами из разных тредов
-- входит в каждый из них.
--
-- Корни ответа хранятся в самой строке сообщения: `chat_thread_root_ids`.
-- Цитаты неизменны (вставляются только в транзакции отправки), поэтому
-- корни пишутся один раз и не пересчитываются. У не-ответа — null: лента
-- «Тредов» — это сообщения с null, под неё частичный индекс.
--
-- Корни — не секрет: это процитированные сообщения или те, на которые
-- отвечали процитированные, то есть то, что смотрящему и так видно по
-- цитатам. Колонка уходит клиенту через `message_rows`. А вот число ответов
-- в колонку не кладётся: счётчик в строке корня раскрыл бы зрителю
-- неопубликованные ответы. Сводки считает функция глазами смотрящего.

alter table public.messages add column chat_thread_root_ids uuid[];

create index messages_chat_thread_feed_idx
  on public.messages (chat_id, seq)
  where chat_thread_root_ids is null;

create index messages_chat_thread_roots_idx
  on public.messages using gin (chat_thread_root_ids)
  where chat_thread_root_ids is not null;

/**
 * Корни нового ответа: для цитаты на ответ — его корни, иначе — само
 * цитируемое. Цитата из островка (`quoted_forward_id`) треда не создаёт.
 */
create function public.link_chat_thread_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  roots uuid[];
begin
  select coalesce(q.chat_thread_root_ids, array[q.id]) into roots
  from public.messages q
  where q.id = new.quoted_id;

  if roots is null then
    return new;
  end if;

  update public.messages m
  set chat_thread_root_ids = (
    select array_agg(distinct r order by r)
    from unnest(coalesce(m.chat_thread_root_ids, '{}'::uuid[]) || roots) r
  )
  where m.id = new.message_id;

  return new;
end;
$$;

create trigger on_reply_quote_linked
  after insert on public.message_replies
  for each row
  when (new.quoted_forward_id is null)
  execute function public.link_chat_thread_reply();

revoke execute on function public.link_chat_thread_reply() from public, anon, authenticated;

-- Засев по истории: по порядку в чате, чтобы корни цитируемых были посчитаны
-- раньше их ответов.
do $$
declare
  reply record;
begin
  for reply in
    select m.id, m.seq
    from public.messages m
    where exists (
      select 1 from public.message_replies r
      where r.message_id = m.id and r.quoted_forward_id is null
    )
    order by m.seq
  loop
    update public.messages m
    set chat_thread_root_ids = (
      select array_agg(distinct root order by root)
      from public.message_replies r
      join public.messages q on q.id = r.quoted_id
      cross join lateral unnest(coalesce(q.chat_thread_root_ids, array[q.id])) root
      where r.message_id = reply.id and r.quoted_forward_id is null
    )
    where m.id = reply.id;
  end loop;
end;
$$;

-- =============================================================================
-- Сообщения глазами смотрящего — с корнями тредов
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
  -- Правка до публикации задержанного зрителю не видна: для него сообщение
  -- такое с самого начала. Не задержанное — как раньше.
  case when t.visible and not h.hidden and (s.member or m.public_at <= m.created_at or m.edited_at > m.public_at) then m.edited_at end as edited_at,
  m.edited_at is not null and not h.hidden and (s.member or m.public_at <= m.created_at or m.edited_at > m.public_at) as edited,
  case
    when m.edited_at is not null and not h.hidden and (s.member or m.public_at <= m.created_at or m.edited_at > m.public_at)
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
  case when h.hidden then '[]'::jsonb else public.hidden_ranges_json(m.hidden_ranges) end as hidden_ranges,
  -- Корни тредов ответа; null — не ответ. Прямая колонка: по ней фильтр
  -- ленты «Тредов» и частичный индекс.
  m.chat_thread_root_ids
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

-- =============================================================================
-- Функции тредов
-- =============================================================================
--
-- Все читают `message_rows` с правами смотрящего: видимость (участник,
-- водораздел, заблокировавшие, время, текст, люди) у них ровно та же, что в
-- переписке, и меняется вместе с представлением.

/**
 * Сводки плашек по корням: сколько видимых мне ответов, последний ответ
 * (номер, время и превью глазами смотрящего) и два последних ответивших с
 * числом остальных. Люди — колонками `message_rows`, то есть глазами
 * смотрящего в контексте чата. Сообщение заблокировавшего в счёт идёт (в
 * шторке оно — заглушка), но не в превью и не в людей.
 */
create function public.chat_thread_summaries(p_root_ids uuid[])
returns table (
  root_id uuid,
  replies_count int,
  last_seq bigint,
  last_created_at timestamptz,
  last_kind text,
  last_text text,
  last_attachments jsonb,
  people jsonb,
  others_count int
)
language sql
stable
security invoker
set search_path = public
as $$
  with roots as (
    select distinct unnest(p_root_ids[1:200]) as id
  ),
  replies as (
    select ro.id as root_id, r.*
    from roots ro
    join public.message_rows r on r.chat_thread_root_ids @> array[ro.id]
  ),
  shown as (
    select * from replies where not hidden
  ),
  last_reply as (
    select distinct on (s.root_id) s.root_id, s.id, s.seq, s.created_at, s.kind, s.text
    from shown s
    order by s.root_id, s.seq desc
  ),
  authors as (
    -- Последнее сообщение каждого ответившего — по нему порядок «последних».
    select distinct on (s.root_id, s.author_id)
      s.root_id, s.author_id, s.author_name, s.author_avatar_url, s.author_opaque, s.seq
    from shown s
    where s.author_id is not null
    order by s.root_id, s.author_id, s.seq desc
  ),
  ranked as (
    select a.*, row_number() over (partition by a.root_id order by a.seq desc) as rank,
      count(*) over (partition by a.root_id) as total
    from authors a
  )
  select
    ro.id,
    (select count(*)::int from replies x where x.root_id = ro.id),
    l.seq,
    l.created_at,
    l.kind::text,
    l.text,
    coalesce((
      select jsonb_agg(jsonb_build_object(
          'url', a.url, 'poster_url', a.poster_url, 'mime_type', a.mime_type,
          'duration_ms', a.duration_ms, 'position', a.position, 'pop_id', a.pop_id
        ) order by a.position)
      from public.attachment_rows a
      where a.message_id = l.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', k.author_id, 'name', k.author_name, 'avatar_url', k.author_avatar_url,
          'opaque', k.author_opaque
        ) order by k.rank)
      from ranked k
      where k.root_id = ro.id and k.rank <= 2
    ), '[]'::jsonb),
    coalesce((select greatest(max(k.total) - 2, 0)::int from ranked k where k.root_id = ro.id), 0)
  from roots ro
  left join last_reply l on l.root_id = ro.id
  where exists (select 1 from replies x where x.root_id = ro.id)
$$;

revoke execute on function public.chat_thread_summaries(uuid[]) from public, anon;
grant execute on function public.chat_thread_summaries(uuid[]) to authenticated;

/**
 * Ответы треда страницей по порядку: после `p_after_seq` по возрастанию или,
 * если задан `p_before_seq`, — самые поздние до него (тоже по возрастанию в
 * ответе). У строки — её цитаты, входящие в этот тред, кроме самого корня:
 * шторка показывает только их.
 */
create function public.list_chat_thread(
  p_root uuid,
  p_after_seq bigint default null,
  p_before_seq bigint default null,
  p_limit int default 50
)
returns table (id uuid, seq bigint, quote_ids uuid[])
language sql
stable
-- Корни цитируемого — из таблицы: удалённая цитата треда тоже остаётся в
-- облачке («Сообщение удалено»), как в переписке. Сами ответы — из
-- `message_rows`, видимость смотрящего.
security definer
set search_path = public
as $$
  with page as (
    select r.id, r.seq
    from public.message_rows r
    where r.chat_thread_root_ids @> array[p_root]
      and (p_after_seq is null or r.seq > p_after_seq)
      and (p_before_seq is null or r.seq < p_before_seq)
    order by
      case when p_before_seq is null then r.seq end asc,
      case when p_before_seq is not null then r.seq end desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  )
  select
    p.id,
    p.seq,
    coalesce((
      select array_agg(q.quoted_id order by q.position)
      from public.message_replies q
      join public.messages qm on qm.id = q.quoted_id
      where q.message_id = p.id
        and q.quoted_forward_id is null
        and q.quoted_id <> p_root
        and qm.chat_thread_root_ids @> array[p_root]
    ), '{}'::uuid[])
  from page p
  order by p.seq
$$;

revoke execute on function public.list_chat_thread(uuid, bigint, bigint, int) from public, anon;
grant execute on function public.list_chat_thread(uuid, bigint, bigint, int) to authenticated;

/**
 * Удалённые исходные сообщения с живыми видимыми мне ответами — заглушки
 * ленты «Тредов», страницей ниже `p_before_seq`. Без ответов удалённое не
 * показывается. Удалённое `message_rows` не отдаёт, поэтому номер — из
 * таблицы (права владельца), а видимость — по ответам из `message_rows`:
 * видимый ответ стоит после корня, значит и место корня смотрящему видно.
 */
create function public.list_chat_thread_deleted_roots(
  p_chat uuid,
  p_before_seq bigint default null,
  p_limit int default 50
)
returns table (id uuid, seq bigint)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.seq
  from public.messages m
  where m.chat_id = p_chat
    and m.deleted_at is not null
    and (p_before_seq is null or m.seq < p_before_seq)
    and m.chat_thread_root_ids is null
    and public.chat_readable(p_chat)
    and exists (
      select 1 from public.message_rows r
      where r.chat_id = p_chat
        and r.chat_thread_root_ids @> array[m.id]
    )
  order by m.seq desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

revoke execute on function public.list_chat_thread_deleted_roots(uuid, bigint, int) from public, anon;
grant execute on function public.list_chat_thread_deleted_roots(uuid, bigint, int) to authenticated;
