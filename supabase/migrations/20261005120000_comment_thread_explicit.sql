-- Ответ в тред без цитаты.
--
-- Тред открывается отдельным окном, и всё, что в нём написано, — ответ в этот
-- тред, даже без цитаты. До сих пор база выводила тред только из цитат
-- (`comment_thread_of`), а части длинного альбома держались в треде скрытой
-- цитатой корня. С удалённым корнем это не работает: его цитата «не найдена»
-- (SELECT-политика удалённое не отдаёт), хотя писать в его тред можно.
--
-- Теперь тред передаётся явно — `thread_root`. Без него — как раньше: тред по
-- цитатам, нет цитат — верхнеуровневый комментарий.
--
-- Корень проверяет схема, а не функция: составной внешний ключ
-- (`comments_thread_root_fkey`) держит корень у того же сообщения, триггер
-- `prepare_comment` — что корень верхнеуровневый. Оба видят удалённый корень:
-- внешний ключ и security definer не смотрят на RLS. Цитаты из того же треда
-- держит триггер `check_comment_reply_thread`. Функция лишь даёт отказам
-- понятный код раньше, чем до них дойдёт вставка.
--
-- Старые сигнатуры удаляются: перегрузку с тем же набором именованных
-- аргументов PostgREST не различит.

/**
 * Годится ли комментарий в корни треда этого сообщения: верхнеуровневый и
 * того же сообщения, удалённый — тоже (тред живёт без корня). Security
 * definer — чтобы увидеть удалённый; наружу уходит только да/нет.
 */
create function public.is_comment_thread_root(target_message uuid, root uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.comments
    where id = root and message_id = target_message and thread_root_id is null
  );
$$;

revoke execute on function public.is_comment_thread_root(uuid, uuid) from public, anon;
grant execute on function public.is_comment_thread_root(uuid, uuid) to authenticated;

/** Тред нового комментария: явный корень или, без него, — по цитатам. */
create function public.resolve_comment_thread(
  target_message uuid,
  reply_to uuid[],
  thread_root uuid
)
returns uuid
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if thread_root is null then
    return public.comment_thread_of(target_message, reply_to);
  end if;

  if not public.is_comment_thread_root(target_message, thread_root) then
    raise exception 'thread root must be a top-level comment of this message' using errcode = '22023';
  end if;

  -- Цитаты сверит триггер `check_comment_reply_thread` при их вставке.
  return thread_root;
end;
$$;

revoke execute on function public.resolve_comment_thread(uuid, uuid[], uuid) from public, anon;
grant execute on function public.resolve_comment_thread(uuid, uuid[], uuid) to authenticated;

drop function public.send_comment(uuid, text, jsonb, uuid[]);
drop function public.send_voice_comment(uuid, jsonb, uuid[]);

-- Та же функция, что в 20261004100000_comment_threads.sql, плюс `thread_root`.
create function public.send_comment(
  target_message uuid,
  comment_text text,
  media jsonb default '[]'::jsonb,
  reply_to uuid[] default null,
  thread_root uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_chat uuid;
  root uuid;
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

  root := public.resolve_comment_thread(target_message, reply_to, thread_root);
  new_kind := case when jsonb_array_length(media) = 0 then 'text' else 'media' end;

  insert into public.comments (chat_id, message_id, author_id, kind, text, thread_root_id)
  values (
    target_chat,
    target_message,
    auth.uid(),
    new_kind,
    nullif(btrim(coalesce(comment_text, '')), ''),
    root
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

revoke execute on function public.send_comment(uuid, text, jsonb, uuid[], uuid) from public, anon;
grant execute on function public.send_comment(uuid, text, jsonb, uuid[], uuid) to authenticated;

create function public.send_voice_comment(
  target_message uuid,
  voice jsonb,
  reply_to uuid[] default null,
  thread_root uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_chat uuid;
  root uuid;
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

  root := public.resolve_comment_thread(target_message, reply_to, thread_root);

  if voice -> 'waveform' is not null and jsonb_typeof(voice -> 'waveform') = 'array' then
    select array_agg(value::smallint order by ord)
    into bars
    from jsonb_array_elements_text(voice -> 'waveform') with ordinality as t(value, ord);
  end if;

  insert into public.comments (chat_id, message_id, author_id, kind, thread_root_id)
  values (target_chat, target_message, auth.uid(), 'voice', root)
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

revoke execute on function public.send_voice_comment(uuid, jsonb, uuid[], uuid) from public, anon;
grant execute on function public.send_voice_comment(uuid, jsonb, uuid[], uuid) to authenticated;
