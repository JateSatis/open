-- Скрытый текст: запись и фрагменты.
--
-- * Отправка: `send_media_message(…, hidden)` и прямая вставка текстового
--   сообщения кладут диапазоны той же строкой — рассылка нового сообщения
--   (отложенный триггер) уже видит их.
-- * Правка: `edit_message(…, hidden)` принимает диапазоны заново вместе с
--   текстом (сдвигает их клиент); без диапазонов при неизменном тексте
--   скрытое остаётся, при новом — снимается.
-- * «Скрыть от зрителей» / «Показать» в отправленном — `set_message_hidden`,
--   только автор. Это не правка: ни ревизии, ни пометки «изменено».
-- * Фрагменты: зритель не выделяет кусок, задевающий скрытое, и не выделяет
--   в неопубликованном. Якоря фрагментов (`exact_text`, контекст) клиенту
--   из таблицы больше не читаются: цитата фрагмента — из `fragment_rows`,
--   список — `list_message_fragments`, обе глазами смотрящего.

-- =============================================================================
-- Отправка с подписью
-- =============================================================================

drop function public.send_media_message(uuid, text, jsonb, uuid[]);

create function public.send_media_message(
  target_chat uuid,
  message_text text,
  media jsonb,
  reply_to uuid[] default null,
  hidden jsonb default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  new_message_id uuid;
  new_kind text;
  item jsonb;
  item_index int := 0;
begin
  if media is null then
    media := '[]'::jsonb;
  end if;

  if jsonb_typeof(media) <> 'array' then
    raise exception 'media должен быть json-массивом';
  end if;

  if jsonb_array_length(media) > 50 then
    raise exception 'Нельзя отправить больше 50 файлов за раз';
  end if;

  new_kind := case when jsonb_array_length(media) = 0 then 'text' else 'media' end;

  insert into public.messages (chat_id, author_id, kind, text, hidden_ranges)
  values (target_chat, auth.uid(), new_kind, message_text, public.hidden_ranges_from_json(hidden))
  returning id into new_message_id;

  for item in select * from jsonb_array_elements(media)
  loop
    insert into public.attachments (
      message_id, message_kind, url, poster_url, mime_type, width, height, duration_ms,
      size_bytes, position
    ) values (
      new_message_id,
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

  perform public.add_message_replies(new_message_id, target_chat, reply_to);

  return new_message_id;
end;
$$;

revoke execute on function public.send_media_message(uuid, text, jsonb, uuid[], jsonb) from public, anon;
grant execute on function public.send_media_message(uuid, text, jsonb, uuid[], jsonb) to authenticated;

-- =============================================================================
-- Правка
-- =============================================================================

drop function public.edit_message(uuid, text, jsonb, jsonb);

create function public.edit_message(
  target_message uuid,
  message_text text,
  media jsonb default '[]'::jsonb,
  voice jsonb default null,
  hidden jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  m public.messages;
  old_files jsonb;
  new_text text := nullif(btrim(coalesce(message_text, '')), '');
  new_kind text;
  new_ranges int4multirange;
  items jsonb;
  item jsonb;
  item_index int := 0;
  kept uuid;
  kept_row public.attachments;
  bars smallint[];
  new_urls text[] := '{}';
  old_urls text[];
  old_pops uuid[];
  latest uuid;
  member record;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if media is null then
    media := '[]'::jsonb;
  end if;

  if jsonb_typeof(media) <> 'array' then
    raise exception 'media должен быть json-массивом' using errcode = '22023';
  end if;

  if voice is not null and jsonb_typeof(voice) = 'null' then
    voice := null;
  end if;

  if voice is not null and jsonb_typeof(voice) <> 'object' then
    raise exception 'voice должен быть json-объектом' using errcode = '22023';
  end if;

  select * into m from public.messages where id = target_message for update;

  if m.id is null or m.deleted_at is not null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if m.author_id is distinct from caller then
    raise exception 'only own messages can be edited' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.chat_members where chat_id = m.chat_id and user_id = caller
  ) then
    raise exception 'only chat members can edit messages' using errcode = '42501';
  end if;

  if m.kind not in ('text', 'media', 'voice') then
    raise exception 'this message cannot be edited' using errcode = '22023';
  end if;

  if voice is not null then
    if new_text is not null or jsonb_array_length(media) > 0 then
      raise exception 'Голосовое идёт без подписи и без других вложений'
        using errcode = 'check_violation';
    end if;

    new_kind := 'voice';
    items := jsonb_build_array(voice);
  elsif jsonb_array_length(media) > 0 then
    if jsonb_array_length(media) > 50 then
      raise exception 'В альбоме не больше 50 файлов' using errcode = 'check_violation';
    end if;

    new_kind := 'media';
    items := media;
  elsif new_text is not null then
    new_kind := 'text';
    items := '[]'::jsonb;
  else
    raise exception 'Пустое сообщение сохранить нельзя' using errcode = 'check_violation';
  end if;

  -- Скрытое: переданное — заново; не переданное остаётся только при том же
  -- тексте, иначе снимается — старые смещения к новому тексту не относятся.
  new_ranges := case
    when hidden is not null then public.hidden_ranges_from_json(hidden)
    when new_text is not distinct from m.text then m.hidden_ranges
    else '{}'::int4multirange
  end;

  if new_text is null or new_kind = 'voice' then
    if not isempty(new_ranges) and hidden is not null then
      raise exception 'Скрыть можно только текст' using errcode = '22023';
    end if;

    new_ranges := '{}'::int4multirange;
  elsif not isempty(new_ranges) and upper(new_ranges) > char_length(new_text) then
    raise exception 'Скрытый кусок выходит за пределы текста' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(items) as i(value)
    where i.value ? 'attachment_id'
      and not exists (
        select 1 from public.attachments a
        where a.message_id = m.id and a.id::text = i.value ->> 'attachment_id'
      )
  ) then
    raise exception 'attachment not found' using errcode = 'P0002';
  end if;

  if (
    select count(*) <> count(distinct i.value ->> 'attachment_id')
    from jsonb_array_elements(items) as i(value)
    where i.value ? 'attachment_id'
  ) then
    raise exception 'attachments repeat' using errcode = '22023';
  end if;

  -- Ссылка на поп сравнивается по попу: своего адреса у неё нет.
  select
    coalesce(array_agg(coalesce(url, 'pop:' || pop_id::text) order by position), '{}'),
    coalesce(array_agg(pop_id order by pop_id) filter (where pop_id is not null), '{}')
  into old_urls, old_pops
  from public.attachments where message_id = m.id;

  select coalesce(
    array_agg(
      coalesce(
        (select coalesce(a.url, 'pop:' || a.pop_id::text) from public.attachments a
         where a.message_id = m.id and a.id::text = i.value ->> 'attachment_id'),
        i.value ->> 'url'
      )
      order by i.ord
    ),
    '{}'
  )
  into new_urls
  from jsonb_array_elements(items) with ordinality as i(value, ord);

  if new_kind = m.kind and new_text is not distinct from m.text and new_urls = old_urls then
    -- Тот же текст и файлы, другое скрытое — это не правка, а «скрыть» /
    -- «показать»: без ревизии и пометки «изменено».
    if new_ranges <> m.hidden_ranges then
      perform public.apply_message_hidden(m, new_ranges);
    end if;

    return;
  end if;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.position), '[]'::jsonb) into old_files
  from public.attachments a where a.message_id = m.id;

  insert into public.message_revisions (
    message_id, chat_id, author_id, kind, text, attachments, version_at
  ) values (
    m.id, m.chat_id, m.author_id, m.kind, m.text, old_files, coalesce(m.edited_at, m.created_at)
  );

  delete from public.attachments where message_id = m.id;

  -- Оставленная ссылка на поп переносится как есть, даже если поп уже удалён.
  perform set_config('open.keep_pop_links', 'on', true);

  update public.messages
  set kind = new_kind, text = new_text, hidden_ranges = new_ranges, edited_at = now()
  where id = m.id;

  for item in select value from jsonb_array_elements(items)
  loop
    if item ? 'attachment_id' then
      kept := (item ->> 'attachment_id')::uuid;

      select * into kept_row
      from jsonb_populate_recordset(null::public.attachments, old_files)
      where id = kept;

      insert into public.attachments (
        id, message_id, message_kind, url, poster_url, mime_type, width, height, duration_ms,
        size_bytes, waveform, position, created_at, pop_id
      ) values (
        kept_row.id, m.id, new_kind, kept_row.url, kept_row.poster_url, kept_row.mime_type,
        kept_row.width, kept_row.height, kept_row.duration_ms, kept_row.size_bytes,
        kept_row.waveform, item_index, kept_row.created_at, kept_row.pop_id
      );
    else
      bars := null;

      if item -> 'waveform' is not null and jsonb_typeof(item -> 'waveform') = 'array' then
        select array_agg(value::smallint order by ord)
        into bars
        from jsonb_array_elements_text(item -> 'waveform') with ordinality as t(value, ord);
      end if;

      insert into public.attachments (
        message_id, message_kind, url, poster_url, mime_type, width, height, duration_ms,
        size_bytes, waveform, position
      ) values (
        m.id,
        new_kind,
        item ->> 'url',
        nullif(item ->> 'poster_url', ''),
        item ->> 'mime_type',
        nullif(item ->> 'width', '')::int,
        nullif(item ->> 'height', '')::int,
        nullif(item ->> 'duration_ms', '')::int,
        nullif(item ->> 'size_bytes', '')::bigint,
        bars,
        item_index
      );
    end if;

    item_index := item_index + 1;
  end loop;

  perform set_config('open.keep_pop_links', '', true);

  if old_pops is distinct from (
    select coalesce(array_agg(pop_id order by pop_id) filter (where pop_id is not null), '{}')
    from public.attachments where message_id = m.id
  ) then
    raise exception 'Поп в посте не убрать и не заменить' using errcode = 'check_violation';
  end if;

  if new_kind = 'media' and exists (
    select 1 from public.attachments
    where message_id = m.id
      and pop_id is null
      and (mime_type is null or not (mime_type like 'image/%' or mime_type like 'video/%'))
  ) then
    raise exception 'В альбоме только фото и видео' using errcode = 'check_violation';
  end if;

  perform public.check_message_shape(m.id);

  select id into latest
  from public.messages
  where chat_id = m.chat_id and deleted_at is null
  order by seq desc
  limit 1;

  if latest = m.id then
    select * into m from public.messages where id = target_message;

    update public.chats
    set last_message_text = public.message_preview_text(m)
    where id = m.chat_id;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object('chat_id', m.chat_id, 'message_id', m.id),
      'message_edited',
      public.message_signal_topic(m.chat_id, m.seq),
      true
    );

    if latest = m.id then
      for member in
        select user_id from public.chat_members where chat_id = m.chat_id
      loop
        perform realtime.send(
          jsonb_build_object('chat_id', m.chat_id),
          'chat_changed',
          'user:' || member.user_id::text,
          true
        );
      end loop;

      -- Приглашённый — ещё не участник: о неопубликованном ему не сообщают.
      if public.message_seq_seen(m.chat_id, m.seq, null) then
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
      end if;
    end if;
  exception
    when others then null;
  end;
end;
$$;

revoke execute on function public.edit_message(uuid, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.edit_message(uuid, text, jsonb, jsonb, jsonb) to authenticated;

-- =============================================================================
-- «Скрыть от зрителей» в отправленном
-- =============================================================================

/**
 * Новое скрытое сообщения: строка, превью чата, сигнал «перечитай». Общая
 * часть `set_message_hidden` и правки без смены текста. Права проверяет
 * вызывающий.
 */
create or replace function public.apply_message_hidden(m public.messages, ranges int4multirange)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  fresh public.messages;
begin
  update public.messages set hidden_ranges = ranges where id = m.id
  returning * into fresh;

  if not exists (
    select 1 from public.messages x
    where x.chat_id = m.chat_id and x.deleted_at is null and x.seq > m.seq
  ) then
    update public.chats
    set last_message_text = public.message_preview_text(fresh)
    where id = m.chat_id;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object('chat_id', m.chat_id, 'message_id', m.id),
      'message_edited',
      public.message_signal_topic(m.chat_id, m.seq),
      true
    );
  exception
    when others then null;
  end;
end;
$$;

revoke execute on function public.apply_message_hidden(public.messages, int4multirange) from public, anon, authenticated;

/**
 * Скрыть кусок своего сообщения от зрителей или показать снова. Только
 * автор; кусок — внутри текста. Возвращает скрытое после изменения.
 */
create or replace function public.set_message_hidden(
  target_message uuid,
  range_start int,
  range_end int,
  hide boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  m public.messages;
  piece int4multirange;
  ranges int4multirange;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into m from public.messages where id = target_message for update;

  if m.id is null or m.deleted_at is not null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if m.author_id is distinct from caller then
    raise exception 'Скрывать можно только в своих сообщениях' using errcode = '42501';
  end if;

  if m.kind not in ('text', 'media') or m.text is null then
    raise exception 'В этом сообщении нет текста' using errcode = '22023';
  end if;

  if range_start is null or range_end is null or range_start < 0 or range_end <= range_start
    or range_end > char_length(m.text)
  then
    raise exception 'Кусок вне текста сообщения' using errcode = '22023';
  end if;

  piece := int4multirange(int4range(range_start, range_end));
  ranges := case when coalesce(hide, true) then m.hidden_ranges + piece else m.hidden_ranges - piece end;

  if ranges <> m.hidden_ranges then
    perform public.apply_message_hidden(m, ranges);
  end if;

  return public.hidden_ranges_json(ranges);
end;
$$;

revoke execute on function public.set_message_hidden(uuid, int, int, boolean) from public, anon;
grant execute on function public.set_message_hidden(uuid, int, int, boolean) to authenticated;

-- =============================================================================
-- Фрагменты
-- =============================================================================

create or replace function public.ensure_fragment(
  target_message uuid,
  range_start integer,
  range_end integer,
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
  seen record;
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

  select * into seen from public.message_seen(m.id);

  -- Неопубликованного для зрителя нет.
  if not seen.seen then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if m.kind not in ('text', 'media', 'voice') or m.text is null then
    raise exception 'this message has no text to select' using errcode = '22023';
  end if;

  if range_start is null or range_end is null or range_start < 0 or range_end <= range_start
     or range_end > char_length(m.text) then
    raise exception 'fragment range is outside the text' using errcode = '22023';
  end if;

  -- Скрытое автором зритель не выделяет: ни целиком, ни краем.
  if not seen.member and m.hidden_ranges && int4range(range_start, range_end) then
    raise exception 'Этот кусок скрыт автором от зрителей' using errcode = '42501';
  end if;

  if range_text is distinct from substr(m.text, range_start + 1, range_end - range_start) then
    raise exception 'fragment text does not match the message' using errcode = '22023';
  end if;

  perform public.lock_fragment_clusters_shared(m.id);

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

  if existing is null then
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
  end if;

  -- Место — до привязки: привязка не меняет подсветку, но событие должно
  -- видеть ровно то, что было на экране в момент выделения.
  perform public.log_fragment_created(existing, caller);
  perform public.attach_fragment(existing);

  return existing;
end;
$$;

/**
 * Кусок фрагмента глазами смотрящего. Живой якорь — из текста сообщения
 * глазами смотрящего (у участника совпадает с `exact_text`). Потерянный —
 * прежний текст: зрителю он отдаётся замазанным целиком, если в сообщении
 * есть скрытое, — где оно было в старой версии, уже не восстановить.
 */
create or replace function public.fragment_seen_text(p_fragment uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f public.message_fragments;
  m public.messages;
  seen record;
begin
  select * into f from public.message_fragments where id = p_fragment;
  select * into m from public.messages where id = f.message_id;

  if f.id is null or m.id is null then
    return null;
  end if;

  select * into seen from public.message_seen(m.id);

  if not seen.seen then
    return null;
  end if;

  if seen.member or isempty(m.hidden_ranges) then
    return f.exact_text;
  end if;

  if f.anchor_state <> 'lost' and f.end_offset <= char_length(m.public_text) then
    return substr(m.public_text, f.start_offset + 1, f.end_offset - f.start_offset);
  end if;

  return repeat('•', char_length(f.exact_text));
end;
$$;

revoke execute on function public.fragment_seen_text(uuid) from public, anon;
grant execute on function public.fragment_seen_text(uuid) to authenticated;

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
    f.start_offset, f.end_offset,
    public.fragment_seen_text(f.id),
    f.anchor_state,
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

-- Якорь и контекст — только глазами смотрящего.
revoke select (exact_text, prefix_text, suffix_text) on public.message_fragments from anon, authenticated;

/**
 * Фрагменты глазами смотрящего — для цитаты фрагмента у комментария.
 * Повторяет SELECT-политику `message_fragments`, неопубликованное зрителю не
 * отдаёт. Связь с комментариями — по составному ключу (id, message_id).
 */
create view public.fragment_rows as
select
  f.id,
  f.message_id,
  f.chat_id,
  f.start_offset,
  f.end_offset,
  f.anchor_state,
  public.fragment_seen_text(f.id) as exact_text,
  f.created_at
from public.message_fragments f
where f.deleted_at is null
  and exists (
    select 1 from public.messages m where m.id = f.message_id and m.deleted_at is null
  )
  and (select s.seen from public.message_seen(f.message_id) s);

revoke all on public.fragment_rows from anon, authenticated;
grant select on public.fragment_rows to authenticated;
