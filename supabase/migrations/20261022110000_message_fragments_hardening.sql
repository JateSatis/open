-- Фрагменты текста, доработка по ревью 20261022100000_message_fragments.sql.
--
-- 1. Фрагменты удалённого сообщения не читаются: их цитата и соседний текст —
--    куски удалённого текста.
-- 2. Потерянный при правке фрагмент забывает соседний текст: он больше не
--    ищется, а `prefix_text` / `suffix_text` — слова, которые автор убрал.
--    Сама цитата (`exact_text`) остаётся — это то, на что ответили.
-- 3. Свой фрагмент на диапазон создаётся по очереди: реакция из меню и
--    комментарий из панели одновременно не плодят две строки.
-- 4. Фрагмент комментария назначает база, а не клиент: функция отправки
--    кладёт запрос фрагмента в настройку транзакции, триггер подготовки
--    комментария находит или создаёт по нему фрагмент. Колонку `fragment_id`
--    клиент больше не пишет, а `fragment_from_request` ему закрыта: пустой
--    фрагмент без комментария и реакции из приложения не создать.
-- 5. Фрагмент — только у комментария к сообщению, не к попу.
-- 6. Перепривязка при правке — в два прохода: место «занято» сверяется с
--    новыми местами всех фрагментов, а не с ещё не перенесёнными.

-- =============================================================================
-- 1. Чтение — только у живого сообщения
-- =============================================================================

drop policy "message_fragments are readable by authenticated users" on public.message_fragments;

create policy "message_fragments are readable by authenticated users"
  on public.message_fragments for select
  to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.messages m
      where m.id = message_fragments.message_id and m.deleted_at is null
    )
  );

-- =============================================================================
-- 2. Потерянный забывает соседний текст
-- =============================================================================

update public.message_fragments
set prefix_text = '', suffix_text = ''
where anchor_state = 'lost';

-- =============================================================================
-- 3–5. Создание фрагмента и фрагмент комментария
-- =============================================================================

-- Та же функция, что в 20261022100000_message_fragments.sql, плюс очередь на
-- автора и диапазон.
create or replace function public.ensure_fragment(
  target_message uuid,
  range_start int,
  range_end int,
  range_text text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  m public.messages;
  existing uuid;
  context int := public.fragment_context_length();
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Правка того же сообщения ждёт: смещения считаются от текста, который не
  -- поменяется до конца транзакции.
  select * into m from public.messages where id = target_message for share;

  if m.id is null or m.deleted_at is not null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if m.kind not in ('text', 'media', 'voice') or m.text is null then
    raise exception 'this message has no text to select' using errcode = '22023';
  end if;

  if range_start is null or range_end is null or range_start < 0 or range_end <= range_start
     or range_end > char_length(m.text) then
    raise exception 'fragment range is outside the text' using errcode = '22023';
  end if;

  if range_text is distinct from substr(m.text, range_start + 1, range_end - range_start) then
    raise exception 'fragment text does not match the message' using errcode = '22023';
  end if;

  -- Два вызова на один диапазон одного автора (реакция и комментарий разом)
  -- — по очереди: второй увидит строку первого.
  perform pg_advisory_xact_lock(
    hashtextextended(m.id::text || ':' || caller::text || ':' || range_start || '-' || range_end, 0)
  );

  select f.id into existing
  from public.message_fragments f
  where f.message_id = m.id
    and f.author_id = caller
    and f.start_offset = range_start
    and f.end_offset = range_end
    and f.deleted_at is null
    and f.anchor_state <> 'lost';

  if existing is not null then
    return existing;
  end if;

  -- Мой спящий на том же месте — он и проснётся: строк не прибавляется.
  select f.id into existing
  from public.message_fragments f
  where f.message_id = m.id
    and f.author_id = caller
    and f.start_offset = range_start
    and f.end_offset = range_end
    and f.exact_text = range_text
    and f.anchor_state <> 'lost'
  order by f.updated_at desc
  limit 1;

  if existing is not null then
    return existing;
  end if;

  insert into public.message_fragments (
    message_id, chat_id, author_id, start_offset, end_offset, exact_text, prefix_text,
    suffix_text, text_version
  ) values (
    m.id,
    m.chat_id,
    caller,
    range_start,
    range_end,
    range_text,
    substr(m.text, greatest(1, range_start - context + 1), least(range_start, context)),
    substr(m.text, range_end + 1, context),
    coalesce(m.edited_at, m.created_at)
  )
  returning id into existing;

  return existing;
end;
$$;

-- Та же функция, но готовый фрагмент — только живой: спящий никто не видит,
-- и комментарий его не будит. Зовёт её только триггер подготовки комментария.
create or replace function public.fragment_from_request(target_message uuid, fragment jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing uuid;
begin
  if fragment is null or jsonb_typeof(fragment) = 'null' then
    return null;
  end if;

  if jsonb_typeof(fragment) <> 'object' then
    raise exception 'fragment должен быть json-объектом' using errcode = '22023';
  end if;

  if fragment ? 'id' then
    select f.id into existing
    from public.message_fragments f
    where f.id = (fragment ->> 'id')::uuid
      and f.message_id = target_message
      and f.deleted_at is null;

    if existing is null then
      raise exception 'fragment not found' using errcode = 'P0002';
    end if;

    return existing;
  end if;

  return public.ensure_fragment(
    target_message,
    (fragment ->> 'start')::int,
    (fragment ->> 'end')::int,
    fragment ->> 'text'
  );
end;
$$;

revoke execute on function public.fragment_from_request(uuid, jsonb) from public, anon, authenticated;

-- Фрагмент комментария назначает только триггер.
revoke insert (fragment_id) on public.comments from authenticated;

alter table public.comments
  add constraint comments_fragment_only_message
    check (fragment_id is null or message_id is not null);

-- Та же функция, что в 20261022100000_message_fragments.sql, плюс фрагмент из
-- настройки транзакции `open.comment_fragment`: её ставит `post_comment` на
-- время своей вставки. Прочитанная настройка сразу гасится — следующая
-- вставка в той же транзакции фрагмента не получит.
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

    if target.kind = 'system' then
      raise exception 'system messages cannot be commented' using errcode = '22023';
    end if;

    if target.kind = 'forward' then
      raise exception 'forwards take no comments: comment on the originals' using errcode = '22023';
    end if;

    if target.kind = 'comment_forward' then
      raise exception 'forwarded comments take no comments' using errcode = '22023';
    end if;
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
    select thread_root_id into root_parent from public.comments where id = new.thread_root_id;

    if root_parent is not null then
      raise exception 'replies go into the thread of a top-level comment' using errcode = '22023';
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

-- Та же функция, что в 20261022100000_message_fragments.sql, но фрагмент
-- уходит триггеру через настройку транзакции, а не колонкой вставки.
create or replace function public.post_comment(
  target_message uuid,
  target_pop uuid,
  comment_text text,
  media jsonb,
  voice jsonb,
  reply_to uuid[],
  thread_root uuid,
  fragment jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  target uuid := coalesce(target_message, target_pop);
  target_chat uuid;
  root uuid;
  new_id uuid;
  new_kind text;
  items jsonb;
  item jsonb;
  item_index int := 0;
  bars smallint[];
  with_fragment boolean := fragment is not null and jsonb_typeof(fragment) <> 'null';
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if num_nonnulls(target_message, target_pop) <> 1 then
    raise exception 'comment goes to one message or one pop' using errcode = '22023';
  end if;

  if voice is not null then
    if jsonb_typeof(voice) <> 'object' then
      raise exception 'voice должен быть json-объектом' using errcode = '22023';
    end if;

    new_kind := 'voice';
    items := jsonb_build_array(voice);
  else
    if media is null then
      media := '[]'::jsonb;
    end if;

    if jsonb_typeof(media) <> 'array' then
      raise exception 'media должен быть json-массивом' using errcode = '22023';
    end if;

    if jsonb_array_length(media) > 50 then
      raise exception 'Нельзя отправить больше 50 файлов за раз' using errcode = 'check_violation';
    end if;

    new_kind := case when jsonb_array_length(media) = 0 then 'text' else 'media' end;
    items := media;
  end if;

  -- Удалённые сообщение и поп SELECT-политики не отдают.
  if target_message is not null then
    select chat_id into target_chat from public.messages where id = target_message;

    if target_chat is null then
      raise exception 'message not found' using errcode = 'P0002';
    end if;
  else
    select ch.posts_chat_id into target_chat
    from public.pops p
    join public.channels ch on ch.id = p.channel_id
    where p.id = target_pop;

    if target_chat is null then
      raise exception 'pop not found' using errcode = 'P0002';
    end if;
  end if;

  root := public.resolve_comment_thread(target, reply_to, thread_root);

  if with_fragment then
    if target_message is null then
      raise exception 'only message text has fragments' using errcode = '22023';
    end if;

    if root is not null then
      raise exception 'only a top-level comment can quote a fragment' using errcode = '22023';
    end if;

    if jsonb_typeof(fragment) <> 'object' then
      raise exception 'fragment должен быть json-объектом' using errcode = '22023';
    end if;

    perform set_config('open.comment_fragment', fragment::text, true);
  end if;

  insert into public.comments (chat_id, message_id, pop_id, author_id, kind, text, thread_root_id)
  values (
    target_chat,
    target_message,
    target_pop,
    auth.uid(),
    new_kind,
    case when new_kind = 'voice' then null else nullif(btrim(coalesce(comment_text, '')), '') end,
    root
  )
  returning id into new_id;

  for item in select value from jsonb_array_elements(items)
  loop
    bars := null;

    if new_kind = 'voice' then
      if item -> 'waveform' is not null and jsonb_typeof(item -> 'waveform') = 'array' then
        select array_agg(value::smallint order by ord)
        into bars
        from jsonb_array_elements_text(item -> 'waveform') with ordinality as t(value, ord);
      end if;

      insert into public.comment_attachments (
        comment_id, comment_kind, url, mime_type, duration_ms, size_bytes, waveform, position
      ) values (
        new_id,
        'voice',
        item ->> 'url',
        item ->> 'mime_type',
        nullif(item ->> 'duration_ms', '')::int,
        nullif(item ->> 'size_bytes', '')::bigint,
        bars,
        0
      );
    else
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
    end if;

    item_index := item_index + 1;
  end loop;

  perform public.add_comment_replies(new_id, target, reply_to);

  return new_id;
end;
$$;

-- =============================================================================
-- 6. Перепривязка — в два прохода
-- =============================================================================

/**
 * Та же логика, что в 20261022100000_message_fragments.sql, но место для
 * каждого фрагмента сначала только находится. «Занято» решается по новым
 * местам всех фрагментов автора: двое на одном месте — старший остаётся,
 * младший теряется. Потом переносимые на миг уходят в `lost` (так им не
 * мешает частичный уникальный индекс) и встают на новые места.
 */
create or replace function public.rebind_message_fragments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.message_fragments;
  context int := public.fragment_context_length();
  body text := new.text;
  len int := char_length(coalesce(new.text, ''));
  piece_len int;
  pos int;
  from_pos int;
  best_score int;
  best_distance int;
  best_start int;
  tie boolean;
  score int;
  distance int;
  plan record;
begin
  create temp table if not exists fragment_rebind_plan (
    id uuid primary key,
    author_id uuid,
    created_at timestamptz,
    old_start int,
    old_state text,
    new_start int,
    new_end int
  ) on commit drop;

  delete from fragment_rebind_plan;

  for f in
    select * from public.message_fragments
    where message_id = new.id and anchor_state <> 'lost'
    order by created_at, id
  loop
    best_start := null;
    best_score := -1;
    best_distance := null;
    tie := false;
    piece_len := char_length(f.exact_text);

    if body is not null and new.kind in ('text', 'media', 'voice') then
      from_pos := 1;

      loop
        pos := strpos(substr(body, from_pos), f.exact_text);
        exit when pos = 0;
        pos := from_pos + pos - 1;

        score := public.common_suffix_length(
          f.prefix_text, substr(body, greatest(1, pos - context), least(pos - 1, context))
        ) + public.common_prefix_length(
          f.suffix_text, substr(body, pos + piece_len, context)
        );
        distance := abs((pos - 1) - f.start_offset);

        if score > best_score or (score = best_score and distance < best_distance) then
          best_start := pos - 1;
          best_score := score;
          best_distance := distance;
          tie := false;
        elsif score = best_score and distance = best_distance then
          tie := true;
        end if;

        from_pos := pos + 1;
        exit when from_pos > len;
      end loop;
    end if;

    insert into fragment_rebind_plan values (
      f.id,
      f.author_id,
      f.created_at,
      f.start_offset,
      f.anchor_state,
      case when best_start is null or tie then null else best_start end,
      case when best_start is null or tie then null else best_start + piece_len end
    );
  end loop;

  -- Двое одного автора на одном новом месте — место за старшим.
  update fragment_rebind_plan p
  set new_start = null, new_end = null
  where p.new_start is not null
    and p.author_id is not null
    and exists (
      select 1 from fragment_rebind_plan o
      where o.id <> p.id
        and o.author_id = p.author_id
        and o.new_start = p.new_start
        and o.new_end = p.new_end
        and (o.created_at, o.id) < (p.created_at, p.id)
    );

  update public.message_fragments mf
  set anchor_state = 'lost'
  from fragment_rebind_plan p
  where mf.id = p.id;

  for plan in select * from fragment_rebind_plan loop
    if plan.new_start is null then
      update public.message_fragments
      set prefix_text = '', suffix_text = ''
      where id = plan.id;
    else
      update public.message_fragments
      set
        anchor_state = case when plan.new_start = plan.old_start then plan.old_state else 'shifted' end,
        start_offset = plan.new_start,
        end_offset = plan.new_end,
        prefix_text = substr(body, greatest(1, plan.new_start - context + 1), least(plan.new_start, context)),
        suffix_text = substr(body, plan.new_end + 1, context)
      where id = plan.id;
    end if;
  end loop;

  return null;
end;
$$;
