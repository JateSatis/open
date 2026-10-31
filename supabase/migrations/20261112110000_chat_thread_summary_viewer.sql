-- Своя прибавка на плашке не увеличивает число авторов, если я уже среди +N.
-- Клиенту нужен только этот факт, без списка остальных людей.
drop function public.chat_thread_summaries(uuid[]);

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
  others_count int,
  viewer_replied boolean
)
language sql
stable
-- Чат корня — из таблицы (корень бывает удалён); ответы — из `message_rows`,
-- видимость смотрящего.
security definer
set search_path = public
as $$
  with roots as (
    select distinct m.id, m.chat_id
    from unnest(p_root_ids[1:200]) as wanted(id)
    join public.messages m on m.id = wanted.id
  ),
  replies as (
    select ro.id as root_id, r.*
    from roots ro
    join public.message_rows r
      on r.chat_id = ro.chat_id and r.chat_thread_root_ids @> array[ro.id]
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
    coalesce((select greatest(max(k.total) - 2, 0)::int from ranked k where k.root_id = ro.id), 0), exists (select 1 from replies x where x.root_id = ro.id and x.author_id = auth.uid())
  from roots ro
  left join last_reply l on l.root_id = ro.id
  where exists (select 1 from replies x where x.root_id = ro.id)
$$;

revoke execute on function public.chat_thread_summaries(uuid[]) from public, anon;
grant execute on function public.chat_thread_summaries(uuid[]) to authenticated;

