-- Постер видео: кадр, который показывается в плитке чата и в ленте, пока
-- видео не запущено. Без него видео в чужой переписке — пустой прямоугольник
-- (картинку из mp4 по ссылке ни Glide, ни iOS не достают), а фрагмент
-- переписки нечем показать в ленте.
--
-- Кадр снимает клиент при отправке и кладёт рядом с видео в том же бакете,
-- поэтому здесь только ссылка. У фото и у старых видео колонка пустая.
alter table public.attachments
  add column poster_url text;

-- Та же функция, что в 20260922120000_message_media.sql, плюс `poster_url`.
create or replace function public.send_media_message(target_chat uuid, message_text text, media jsonb)
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

  return new_message_id;
end;
$$;
