-- Голосовые сообщения: отправка одной транзакцией, инварианты и превью.
--
-- Голосовое — это сообщение `kind = 'voice'` ровно с одним вложением-аудио.
-- «Не больше одного» уже держит `attachments_single_media`. Здесь добавляется
-- «не меньше одного», аудио-mime и длительность: сообщение без файла или с
-- видео вместо звука облачко нарисовать не может, и фрагмент в ленте на нём
-- сломается. Поэтому это проверки базы, а не клиента: вложения вставляются
-- через PostgREST, и клиент здесь не защита.

-- =============================================================================
-- Форма волны
-- =============================================================================
--
-- Столбики волны снимаются с уровня микрофона во время записи и нужны каждому,
-- кто показывает голосовое: облачку в чате и карточке в ленте. Вычислить их
-- потом из файла можно только скачав его целиком, поэтому они хранятся рядом.
-- Значения 0..31 и не больше 64 столбиков, как у Telegram: этого хватает на
-- облачко, а строка остаётся маленькой. Колонка общая, не только для голосовых:
-- у кружков волна тоже появится.
alter table public.attachments
  add column waveform smallint[],
  add constraint attachments_waveform_shape check (
    waveform is null
    or (
      array_ndims(waveform) = 1
      and cardinality(waveform) between 1 and 64
      and array_position(waveform, null) is null
      and 0 <= all (waveform)
      and 31 >= all (waveform)
    )
  );

-- Вложение голосового — это звук известной длины: без длительности облачко
-- не покажет время до загрузки файла и прыгнет, когда файл загрузится.
alter table public.attachments
  add constraint attachments_voice_is_audio check (
    message_kind <> 'voice'
    or (mime_type like 'audio/%' and duration_ms > 0)
  );

-- =============================================================================
-- Ровно одно вложение
-- =============================================================================
--
-- Вложение вставляется после сообщения, поэтому проверить его наличие в момент
-- вставки сообщения нельзя. Отложенный триггер проверяет в конце транзакции:
-- голосовое без файла, вставленное напрямую в `messages`, откатывается целиком.
-- `kind` сообщения клиенту менять нельзя (права на колонки в
-- 20260926120000_chat_invites.sql), поэтому достаточно вставки. Удалять
-- вложения клиенту тоже нечем: политики на delete у `attachments` нет.
create function public.enforce_voice_attachment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'voice'
     and (select count(*) from public.attachments where message_id = new.id) <> 1 then
    raise exception 'У голосового сообщения должно быть ровно одно вложение'
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

create constraint trigger on_voice_message_created
  after insert on public.messages
  deferrable initially deferred
  for each row execute function public.enforce_voice_attachment();

-- =============================================================================
-- Отправка голосового
-- =============================================================================
--
-- Отдельная функция, а не ветка `send_media_message`: у голосового нет
-- подписи и альбома, зато есть волна. Security invoker: вставка идёт под теми
-- же политиками RLS, что и текст, — отправить может только участник чата.
create function public.send_voice_message(target_chat uuid, voice jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_message_id uuid;
  bars smallint[];
begin
  if voice is null or jsonb_typeof(voice) <> 'object' then
    raise exception 'voice должен быть json-объектом';
  end if;

  if voice -> 'waveform' is not null and jsonb_typeof(voice -> 'waveform') = 'array' then
    select array_agg(value::smallint order by ord)
    into bars
    from jsonb_array_elements_text(voice -> 'waveform') with ordinality as t(value, ord);
  end if;

  insert into public.messages (chat_id, author_id, kind)
  values (target_chat, auth.uid(), 'voice')
  returning id into new_message_id;

  insert into public.attachments (
    message_id, message_kind, url, mime_type, duration_ms, size_bytes, waveform, position
  ) values (
    new_message_id,
    'voice',
    voice ->> 'url',
    voice ->> 'mime_type',
    nullif(voice ->> 'duration_ms', '')::int,
    nullif(voice ->> 'size_bytes', '')::bigint,
    bars,
    0
  );

  return new_message_id;
end;
$$;

grant execute on function public.send_voice_message(uuid, jsonb) to authenticated;

-- =============================================================================
-- Превью в списке чатов и в уведомлении
-- =============================================================================
--
-- Длительность голосового лежит во вложении, а вложение вставляется после
-- сообщения. Поэтому рассылка переезжает в конец транзакции (отложенный
-- триггер): к этому моменту вложения уже на месте, и превью берёт длительность
-- без лишнего запроса с клиента. Для остального это ничего не меняет: realtime
-- и так уходит только после commit, а откат по-прежнему не рассылает ничего.
drop trigger on_message_created on public.messages;

create or replace function public.broadcast_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
  member record;
  author_name text;
  preview_text text;
  voice_ms int;
begin
  if new.kind = 'voice' then
    select duration_ms into voice_ms
    from public.attachments
    where message_id = new.id
    limit 1;
  end if;

  preview_text := case
    when new.text is not null then new.text
    when new.kind = 'media' then '📷 Медиа'
    -- Та же запись, что у `formatDuration` на клиенте: m:ss, секунды вниз, но
    -- не меньше одной — «0:00» у отправленного голосового выглядит поломкой.
    when new.kind = 'voice' and voice_ms is not null then
      format(
        '🎤 Голосовое сообщение (%s:%s)',
        greatest(voice_ms / 1000, 1) / 60,
        lpad((greatest(voice_ms / 1000, 1) % 60)::text, 2, '0')
      )
    when new.kind = 'voice' then '🎤 Голосовое сообщение'
    else new.text
  end;

  update public.chats
  set
    last_message_at = new.created_at,
    last_message_text = preview_text,
    last_message_author_id = new.author_id
  where id = new.chat_id;

  select display_name into author_name from public.profiles where id = new.author_id;

  payload := jsonb_build_object(
    'message_id', new.id,
    'chat_id', new.chat_id,
    'author_id', new.author_id,
    'author_name', author_name,
    'text', preview_text,
    'created_at', new.created_at
  );

  begin
    perform realtime.send(payload, 'new_message', 'chat:' || new.chat_id::text, true);

    for member in
      select user_id from public.chat_members
      where chat_id = new.chat_id and user_id <> new.author_id
    loop
      perform realtime.send(payload, 'new_message', 'user:' || member.user_id::text, true);
    end loop;

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

create constraint trigger on_message_created
  after insert on public.messages
  deferrable initially deferred
  for each row execute function public.broadcast_new_message();
