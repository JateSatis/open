-- Альбомы: несколько фото/видео в одном сообщении.
--
-- Одно сообщение — один ряд `messages`, а не N сообщений на N файлов: именно
-- так его можно показать одним облачком-мозаикой в чате и одной карточкой в
-- ленте. Вид `media` покрывает и одиночное фото, и смешанный набор фото и
-- видео — различать фото/видео внутри такого сообщения клиент может по
-- `mime_type` вложения, отдельный вид на файл не нужен.

alter table public.messages
  drop constraint messages_kind_check,
  add constraint messages_kind_check
    check (kind in ('text', 'photo', 'video', 'voice', 'video_note', 'system', 'media'));

-- =============================================================================
-- Порядок вложений
-- =============================================================================
--
-- Мозаика должна собираться в том порядке, в котором пользователь выбрал
-- файлы, а PostgREST не гарантирует порядок вложенной выборки без explicit
-- order — нужна колонка, а не полагаться на created_at (несколько вложений
-- одного сообщения загружаются достаточно быстро, чтобы совпасть по времени).
--
-- Верхняя граница на позицию — заодно и защита от неограниченного альбома:
-- лимит в 50 файлов задуман как продуктовый (клиентский), но раз вставка
-- вложений идёт напрямую через PostgREST в обход клиента, дыру нужно закрыть
-- в БД. `unique(message_id, position)` вместе с `position < 50` не позволяют
-- вставить больше 50 строк на одно сообщение ни при каких обстоятельствах.
alter table public.attachments
  add column position int not null default 0 check (position >= 0 and position < 50);

create unique index attachments_message_id_position_key
  on public.attachments (message_id, position);

-- =============================================================================
-- Отправка сообщения с вложениями одной транзакцией
-- =============================================================================
--
-- Сообщение и его вложения обязаны появиться атомарно: как только строка в
-- `messages` вставлена, срабатывает триггер рассылки — сообщение без
-- вложений (или потерявшее часть при сбое на середине) уже разослано
-- участникам чата и попало в превью списка. Прямая последовательная вставка
-- с клиента (insert сообщения, затем N insert вложений) не даёт такой
-- гарантии; функция с security invoker — даёт, оставаясь под теми же
-- политиками RLS, что и обычная отправка текста.
create function public.send_media_message(target_chat uuid, message_text text, media jsonb)
returns uuid
language plpgsql
security invoker
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

  insert into public.messages (chat_id, author_id, kind, text)
  values (target_chat, auth.uid(), new_kind, message_text)
  returning id into new_message_id;

  for item in select * from jsonb_array_elements(media)
  loop
    insert into public.attachments (
      message_id, message_kind, url, mime_type, width, height, duration_ms, size_bytes, position
    ) values (
      new_message_id,
      new_kind,
      item ->> 'url',
      item ->> 'mime_type',
      nullif(item ->> 'width', '')::int,
      nullif(item ->> 'height', '')::int,
      nullif(item ->> 'duration_ms', '')::int,
      nullif(item ->> 'size_bytes', '')::bigint,
      item_index
    );

    item_index := item_index + 1;
  end loop;

  return new_message_id;
end;
$$;

grant execute on function public.send_media_message(uuid, text, jsonb) to authenticated;

-- =============================================================================
-- Превью альбома в списке чатов
-- =============================================================================
--
-- Вложения появляются вторым шагом внутри той же транзакции (см. функцию
-- выше), уже после того как сработал этот триггер, — на момент триггера
-- `broadcast_new_message` о них ещё ничего не известно, известен только
-- `new.kind`. Этого достаточно, чтобы не оставить последнее сообщение чата
-- пустой строкой в превью.
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
begin
  preview_text := case
    when new.text is not null then new.text
    when new.kind = 'media' then '📷 Медиа'
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
  exception
    when others then null;
  end;

  return new;
end;
$$;
