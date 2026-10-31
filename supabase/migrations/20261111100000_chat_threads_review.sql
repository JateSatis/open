-- Треды: правки после ревью.
--
-- Корни ответа пишет только база. Колонка `chat_thread_root_ids` — в той же
-- строке, что вставляет клиент (текстовое сообщение — прямой INSERT под
-- политикой участника), и без защиты её можно было подставить: сообщение
-- без цитат ушло бы из ленты «Тредов», а с чужим корнем — в плашку и шторку
-- другого чата. Теперь вставка всегда начинается с null (корни дописывает
-- триггер цитат), а функции тредов берут ответы только из чата корня.
--
-- Заодно заглушки удалённых корней сначала ищут ответы по таблице и
-- GIN-индексу, а видимость считают только у найденных.

create function public.reset_chat_thread_roots()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.chat_thread_root_ids := null;
  return new;
end;
$$;

create trigger on_message_thread_roots_reset
  before insert on public.messages
  for each row execute function public.reset_chat_thread_roots();

revoke execute on function public.reset_chat_thread_roots() from public, anon, authenticated;

create or replace function public.chat_thread_summaries(p_root_ids uuid[])
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
create or replace function public.list_chat_thread(
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
    where r.chat_id = (select m.chat_id from public.messages m where m.id = p_root)
      and r.chat_thread_root_ids @> array[p_root]
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
        and qm.chat_id = q.chat_id
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
create or replace function public.list_chat_thread_deleted_roots(
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
    -- Сначала дёшево, по таблице и GIN-индексу: есть ли живой ответ вообще.
    -- Видимость смотрящему — уже только у таких.
    and exists (
      select 1 from public.messages a
      where a.chat_id = p_chat
        and a.deleted_at is null
        and a.chat_thread_root_ids @> array[m.id]
    )
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
