-- Правка поста не спотыкается об удалённый поп.
--
-- `edit_message` пересобирает вложения заново, а проверка ссылки на поп
-- (`check_attachment_pop`) требовала живой поп. Когда появится удаление попа
-- (этап 3), текст поста с ним стало бы нельзя поправить — с отказом «поп из
-- другого канала». Новая ссылка по-прежнему требует живой поп; уже стоявшая
-- в посте ссылка, которую правка переносит как есть, — только тот же канал.
-- Перенос правка помечает флагом `open.keep_pop_links` на время своей
-- транзакции; клиенту он недоступен: прямой вставки ссылки на поп у него нет.

create or replace function public.check_attachment_pop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  keeping boolean := current_setting('open.keep_pop_links', true) = 'on';
begin
  if new.message_kind <> 'media' then
    raise exception 'Поп прикрепляется только к посту' using errcode = 'check_violation';
  end if;

  if not exists (
    select 1
    from public.pops p
    join public.channels ch on ch.id = p.channel_id
    join public.messages m on m.chat_id = ch.posts_chat_id
    where p.id = new.pop_id
      and (keeping or p.deleted_at is null)
      and m.id = new.message_id
  ) then
    raise exception 'Поп из другого канала' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Та же функция, что в 20261008100000_channel_pops.sql: перенос оставленных
-- вложений — под флагом `open.keep_pop_links`.
create or replace function public.edit_message(
  target_message uuid,
  message_text text,
  media jsonb default '[]'::jsonb,
  voice jsonb default null
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
  set kind = new_kind, text = new_text, edited_at = now()
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
  order by created_at desc
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
      'chat:' || m.chat_id::text,
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
  exception
    when others then null;
  end;
end;
$$;
