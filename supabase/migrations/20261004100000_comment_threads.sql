-- Треды комментариев и ранжированный список.
--
-- Комментарии больше не чат. Верхнеуровневые комментарии сообщения идут
-- списком по рангу — сверху популярные, — а ответ на комментарий ложится в
-- тред этого комментария. Тред одноуровневый: ответ на ответ продолжает тот
-- же тред, под-тредов нет.
--
-- Инварианты — в схеме, а не в клиенте:
--   - корень треда — верхнеуровневый комментарий того же сообщения (составной
--     внешний ключ и триггер);
--   - цитаты (`comment_replies`) бывают только у ответа в треде и только из
--     этого треда — корень или другие его ответы (триггер);
--   - одним ответом нельзя процитировать комментарии двух тредов: тред ответа
--     выводит из цитат функция отправки, и цитаты разных тредов она отвергает.
--
-- Ранг и число ответов — денормализованно в строке, как остальные счётчики:
-- список не считает агрегат на каждую страницу.

-- =============================================================================
-- Тред и счётчик ответов
-- =============================================================================

alter table public.comments
  add column thread_root_id uuid,
  add column replies_count int not null default 0,
  add constraint comments_thread_root_fkey
    foreign key (thread_root_id, message_id) references public.comments (id, message_id) on delete cascade,
  add constraint comments_thread_root_not_self check (thread_root_id <> id);

-- Тред по порядку: сверху первые.
create index comments_thread_root_id_created_at_idx
  on public.comments (thread_root_id, created_at)
  where deleted_at is null;

-- Ответ на комментарий из треда — как и комментарий, от любого
-- аутентифицированного. Обычный путь — `send_comment` (security invoker).
grant insert (thread_root_id) on public.comments to authenticated;

-- =============================================================================
-- Ранг
-- =============================================================================
--
-- Формула вида Reddit hot: log10 вовлечённости плюс время. Она монотонна во
-- времени, поэтому её не пересчитывает крон: ранг меняется только вместе со
-- счётчиками. Среди равных по вовлечённости выше свежий.
--
-- Вовлечённость — 1 + реакции + 3 × ответы: ответ — это разговор, он весит
-- больше реакции. Единица — чтобы у нового комментария без реакций был ноль,
-- а первая реакция уже поднимала его (log10(2) ≈ 0,3).
--
-- Время делится на 45000 с (12,5 ч): десятикратная вовлечённость держит
-- комментарий выше нового на 12,5 ч, одна реакция — примерно на 3,8 ч.

/**
 * Immutable на самом деле: эпоха момента времени от часового пояса не
 * зависит, хотя `extract` от timestamptz и объявлен stable. Иначе ранг не
 * мог бы быть генерируемой колонкой. Plpgsql — чтобы планировщик не
 * подставлял тело и не спорил с объявленной неизменностью.
 */
create function public.comment_rank(created timestamptz, reactions int, replies int)
returns double precision
language plpgsql
immutable
parallel safe
as $$
begin
  return log(greatest(1 + coalesce(reactions, 0) + 3 * coalesce(replies, 0), 1)::double precision)
    + extract(epoch from created)::double precision / 45000;
end;
$$;

alter table public.comments
  add column rank double precision
    generated always as (public.comment_rank(created_at, reactions_count, replies_count)) stored;

-- Постраничная выборка верха: keyset по (rank, id). Удалённые корни с живыми
-- ответами в выборке остаются заглушкой, поэтому фильтра по `deleted_at` в
-- индексе нет.
create index comments_thread_roots_rank_idx
  on public.comments (message_id, rank desc, id desc)
  where thread_root_id is null;

-- =============================================================================
-- Корень — верхнеуровневый
-- =============================================================================

-- Та же функция, что в 20261002100000_forward_islands.sql, плюс тред.
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

  -- Удалённый корень тред не закрывает: его ответы живы, и тред продолжается.
  -- Чужое сообщение у корня отвергнет составной внешний ключ.
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

-- =============================================================================
-- Цитаты — только внутри треда
-- =============================================================================

/**
 * Цитата у ответа в треде, и цитируется корень или другой ответ этого же
 * треда. У верхнеуровневого комментария цитат нет: ответ на него — это и
 * есть тред.
 */
create function public.check_comment_reply_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  root uuid;
  quoted_root uuid;
  quoted_id uuid;
begin
  select thread_root_id into root from public.comments where id = new.comment_id;

  if root is null then
    raise exception 'top-level comments carry no quotes' using errcode = '22023';
  end if;

  select id, thread_root_id into quoted_id, quoted_root from public.comments where id = new.quoted_id;

  if quoted_id is distinct from root and quoted_root is distinct from root then
    raise exception 'quotes must come from the same thread' using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger on_comment_reply_written
  before insert on public.comment_replies
  for each row execute function public.check_comment_reply_thread();

/**
 * Тред ответа по его цитатам: корень у всех цитат должен быть один. Нет
 * цитат — это не ответ, а верхнеуровневый комментарий. Security invoker:
 * удалённую цитату не видно по SELECT-политике, и она — «не найдена».
 */
create function public.comment_thread_of(target_message uuid, reply_to uuid[])
returns uuid
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  wanted int := coalesce(cardinality(array(select distinct unnest(reply_to))), 0);
  found int;
  roots uuid[];
begin
  if wanted = 0 then
    return null;
  end if;

  select count(*), array_agg(distinct coalesce(thread_root_id, id))
  into found, roots
  from public.comments
  where id = any (reply_to) and message_id = target_message;

  if found <> wanted then
    raise exception 'quoted comment not found' using errcode = 'P0002';
  end if;

  if cardinality(roots) <> 1 then
    raise exception 'quotes must come from one thread' using errcode = '22023';
  end if;

  return roots[1];
end;
$$;

revoke execute on function public.comment_thread_of(uuid, uuid[]) from public, anon;
grant execute on function public.comment_thread_of(uuid, uuid[]) to authenticated;

-- =============================================================================
-- Отправка в тред
-- =============================================================================
--
-- Те же функции, что в 20261003100000_comment_reactions_and_replies.sql: тред
-- выводится из цитат. Ответ только на корень — тоже цитата (корня): так
-- ответ на верхнеуровневый комментарий и ответ на ответ — одно действие.

create or replace function public.send_comment(
  target_message uuid,
  comment_text text,
  media jsonb default '[]'::jsonb,
  reply_to uuid[] default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_chat uuid;
  thread_root uuid;
  new_id uuid;
  new_kind text;
  item jsonb;
  item_index int := 0;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if media is null then
    media := '[]'::jsonb;
  end if;

  if jsonb_typeof(media) <> 'array' then
    raise exception 'media должен быть json-массивом' using errcode = '22023';
  end if;

  if jsonb_array_length(media) > 50 then
    raise exception 'Нельзя отправить больше 50 файлов за раз' using errcode = 'check_violation';
  end if;

  select chat_id into target_chat from public.messages where id = target_message;

  if target_chat is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  thread_root := public.comment_thread_of(target_message, reply_to);
  new_kind := case when jsonb_array_length(media) = 0 then 'text' else 'media' end;

  insert into public.comments (chat_id, message_id, author_id, kind, text, thread_root_id)
  values (
    target_chat,
    target_message,
    auth.uid(),
    new_kind,
    nullif(btrim(coalesce(comment_text, '')), ''),
    thread_root
  )
  returning id into new_id;

  for item in select value from jsonb_array_elements(media)
  loop
    insert into public.comment_attachments (
      comment_id, comment_kind, url, poster_url, mime_type, width, height, duration_ms,
      size_bytes, position
    ) values (
      new_id,
      new_kind,
      item ->> 'url',
      nullif(item ->> 'poster_url', ''),
      item ->> 'mime_type',
      nullif(item ->> 'width', '')::int,
      nullif(item ->> 'height', '')::int,
      nullif(item ->> 'duration_ms', '')::int,
      nullif(item ->> 'size_bytes', '')::bigint,
      item_index
    );

    item_index := item_index + 1;
  end loop;

  perform public.add_comment_replies(new_id, target_message, reply_to);

  return new_id;
end;
$$;

create or replace function public.send_voice_comment(
  target_message uuid,
  voice jsonb,
  reply_to uuid[] default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_chat uuid;
  thread_root uuid;
  new_id uuid;
  bars smallint[];
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if voice is null or jsonb_typeof(voice) <> 'object' then
    raise exception 'voice должен быть json-объектом' using errcode = '22023';
  end if;

  select chat_id into target_chat from public.messages where id = target_message;

  if target_chat is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  thread_root := public.comment_thread_of(target_message, reply_to);

  if voice -> 'waveform' is not null and jsonb_typeof(voice -> 'waveform') = 'array' then
    select array_agg(value::smallint order by ord)
    into bars
    from jsonb_array_elements_text(voice -> 'waveform') with ordinality as t(value, ord);
  end if;

  insert into public.comments (chat_id, message_id, author_id, kind, thread_root_id)
  values (target_chat, target_message, auth.uid(), 'voice', thread_root)
  returning id into new_id;

  insert into public.comment_attachments (
    comment_id, comment_kind, url, mime_type, duration_ms, size_bytes, waveform, position
  ) values (
    new_id,
    'voice',
    voice ->> 'url',
    voice ->> 'mime_type',
    nullif(voice ->> 'duration_ms', '')::int,
    nullif(voice ->> 'size_bytes', '')::bigint,
    bars,
    0
  );

  perform public.add_comment_replies(new_id, target_message, reply_to);

  return new_id;
end;
$$;

-- =============================================================================
-- Счётчики и события
-- =============================================================================
--
-- Та же функция, что в 20260930180000_comments.sql, плюс число ответов у
-- корня и тред в payload. `messages.comments_count` считает все комментарии,
-- и ответы в тредах тоже: в шапке панели — весь разговор, как на YouTube.

create or replace function public.handle_comment_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  delta int := 0;
  event text;
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
    update public.messages
    set comments_count = greatest(0, comments_count + delta)
    where id = new.message_id;

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
        'comment_id', new.id,
        'thread_root_id', new.thread_root_id
      ),
      event,
      'comments:' || new.message_id::text,
      true
    );

    if delta <> 0 then
      perform realtime.send(
        jsonb_build_object('chat_id', new.chat_id, 'message_id', new.message_id),
        'comments_changed',
        'chat:' || new.chat_id::text,
        true
      );
    end if;
  exception
    when others then null;
  end;

  return null;
end;
$$;

-- =============================================================================
-- Выборка верха
-- =============================================================================

/**
 * Страница верхнеуровневых комментариев сообщения по рангу: keyset по
 * (rank, id), без OFFSET. Удалённый корень с живыми ответами остаётся в
 * списке заглушкой — без автора, текста и реакций: тред не исчезает вместе с
 * корнем. Удалённый без ответов не отдаётся.
 *
 * Security definer — только чтобы увидеть такой корень: SELECT-политика
 * удалённое не отдаёт. Содержимое удалённого отсюда не уходит, вложения
 * клиент встраивает под их собственной политикой — у удалённого их не будет.
 */
create function public.list_thread_roots(
  target_message uuid,
  after_rank double precision default null,
  after_id uuid default null,
  page_size int default 30
)
returns setof public.comments
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.comments;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  for c in
    select *
    from public.comments
    where message_id = target_message
      and thread_root_id is null
      and (deleted_at is null or replies_count > 0)
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

revoke execute on function public.list_thread_roots(uuid, double precision, uuid, int) from public, anon;
grant execute on function public.list_thread_roots(uuid, double precision, uuid, int) to authenticated;

-- =============================================================================
-- Старые ответы → треды
-- =============================================================================
--
-- До этой миграции ответ цитировал любые комментарии ветки. Теперь каждый
-- комментарий с цитатами становится ответом в треде: корень — верхнеуровневый
-- предок первой цитаты (цитата, сама бывшая ответом, ведёт к своему корню).
-- Комментарии обходятся по времени, поэтому предок уже разобран.
--
-- Цитаты, которые в тред ответа не укладываются (из другого треда), из
-- `comment_replies` уходят, но не теряются: связь остаётся в
-- `legacy_comment_quotes` — только для модерации, пользователям закрыта.

create table public.legacy_comment_quotes (
  id uuid primary key default gen_random_uuid (),
  comment_id uuid not null references public.comments (id) on delete cascade,
  quoted_id uuid not null references public.comments (id) on delete cascade,
  position int not null,
  /** Когда цитату поставили. */
  quoted_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index legacy_comment_quotes_comment_id_idx on public.legacy_comment_quotes (comment_id);

alter table public.legacy_comment_quotes enable row level security;

revoke all on public.legacy_comment_quotes from anon, authenticated;

do $$
declare
  c record;
  root uuid;
begin
  for c in
    select cm.id
    from public.comments cm
    where exists (select 1 from public.comment_replies r where r.comment_id = cm.id)
    order by cm.created_at, cm.id
  loop
    select coalesce(q.thread_root_id, q.id) into root
    from public.comment_replies r
    join public.comments q on q.id = r.quoted_id
    where r.comment_id = c.id
    order by r.position
    limit 1;

    update public.comments set thread_root_id = root where id = c.id;
  end loop;

  insert into public.legacy_comment_quotes (comment_id, quoted_id, position, quoted_at)
  select r.comment_id, r.quoted_id, r.position, r.created_at
  from public.comment_replies r
  join public.comments cm on cm.id = r.comment_id
  join public.comments q on q.id = r.quoted_id
  where q.id is distinct from cm.thread_root_id
    and q.thread_root_id is distinct from cm.thread_root_id;

  delete from public.comment_replies r
  using public.comments cm, public.comments q
  where cm.id = r.comment_id
    and q.id = r.quoted_id
    and q.id is distinct from cm.thread_root_id
    and q.thread_root_id is distinct from cm.thread_root_id;

  update public.comments root_row
  set replies_count = counted.n
  from (
    select thread_root_id, count(*)::int as n
    from public.comments
    where thread_root_id is not null and deleted_at is null
    group by thread_root_id
  ) counted
  where root_row.id = counted.thread_root_id;
end;
$$;

-- Служебное — не для прямого вызова.
revoke execute on function public.check_comment_reply_thread() from public, anon, authenticated;
