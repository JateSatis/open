-- Правка сообщений.
--
-- Правка собирает сообщение заново: текст, набор вложений и, если нужно, вид
-- (текст ↔ альбом ↔ голосовое). Прежняя версия целиком уходит в
-- `message_revisions`, которую видит только модерация.
--
-- До этой миграции у автора было право прямого UPDATE `text` и `edited_at`
-- (20260926120000_chat_invites.sql): текст разошедшегося сообщения можно было
-- тихо подменить, без «изменено», с выдуманным временем правки и без следа.
-- Теперь содержимое сообщения меняется только функциями: `edit_message` и
-- `delete_messages`. Обе — security definer и сами проверяют автора.

-- =============================================================================
-- Прямая запись закрыта
-- =============================================================================

-- `delete_messages` работает от владельца таблицы и в этих правах не
-- нуждается; политика на UPDATE без права на него ничего не значит.
revoke update on public.messages from anon, authenticated;
drop policy "messages are editable by their author" on public.messages;

-- Время правки ставит только сервер: новое сообщение не может прийти уже
-- «изменённым». Функции отправки `edited_at` не пишут, так что это касается
-- лишь прямой вставки через PostgREST.
create function public.reset_message_edited_at()
returns trigger
language plpgsql
as $$
begin
  new.edited_at := null;
  return new;
end;
$$;

create trigger on_message_inserted_reset_edited_at
  before insert on public.messages
  for each row execute function public.reset_message_edited_at();

-- Дописать вложение можно только в той транзакции, в которой сообщение
-- создано, — тот же приём, что у `message_replies`: время сообщения по
-- умолчанию `now()`, начало транзакции. Иначе автор прямым INSERT добавлял
-- бы файлы к старому сообщению в обход правки: без «изменено» и без ревизии.
drop policy "attachments can only be added by the message author" on public.attachments;

create policy "attachments are added by the author when sending"
  on public.attachments for insert
  to authenticated
  with check (
    exists (
      select 1 from public.messages m
      where m.id = attachments.message_id
        and m.author_id = auth.uid()
        and m.created_at = now()
    )
  );

revoke update, delete on public.attachments from anon, authenticated;

-- =============================================================================
-- Форма сообщения
-- =============================================================================
--
-- Что сообщение каждого вида обязано иметь, чтобы его можно было нарисовать в
-- чате и во фрагменте ленты. Раньше проверялось только голосовое и только при
-- вставке сообщения (`enforce_voice_attachment`). Правка меняет вид и
-- вложения уже существующего сообщения, поэтому проверка теперь срабатывает
-- на любое изменение формы: вставку и смену вида или текста сообщения,
-- вставку и удаление вложения. Отложенно — в конце транзакции, когда
-- сообщение собрано целиком.
--
-- Старые виды (photo, video, video_note) и системные не трогаются: новых
-- таких сообщений клиент не создаёт, а правка их не принимает.

create function public.check_message_shape(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.messages;
  files int;
begin
  select * into m from public.messages where id = target;

  -- Строки нет — чат удалён каскадом; удалённое мягко не проверяется: его
  -- никто не увидит, а правка удалённого запрещена отдельно.
  if m.id is null or m.deleted_at is not null then
    return;
  end if;

  select count(*) into files from public.attachments where message_id = target;

  if m.kind = 'voice' and (files <> 1 or m.text is not null) then
    raise exception 'У голосового сообщения должно быть ровно одно вложение и нет подписи'
      using errcode = 'check_violation';
  end if;

  if m.kind = 'media' and files = 0 then
    raise exception 'В альбоме должен быть хотя бы один файл'
      using errcode = 'check_violation';
  end if;

  if m.kind = 'text' and (files > 0 or coalesce(btrim(m.text), '') = '') then
    raise exception 'Текстовое сообщение — непустой текст без вложений'
      using errcode = 'check_violation';
  end if;
end;
$$;

revoke execute on function public.check_message_shape(uuid) from public, anon, authenticated;

create function public.enforce_message_shape()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'attachments' then
    perform public.check_message_shape(coalesce(new.message_id, old.message_id));
  else
    perform public.check_message_shape(new.id);
  end if;

  return null;
end;
$$;

drop trigger on_voice_message_created on public.messages;
drop function public.enforce_voice_attachment();

create constraint trigger on_message_shape_changed
  after insert or update of kind, text on public.messages
  deferrable initially deferred
  for each row execute function public.enforce_message_shape();

create constraint trigger on_attachments_changed
  after insert or delete on public.attachments
  deferrable initially deferred
  for each row execute function public.enforce_message_shape();

-- =============================================================================
-- Ревизии
-- =============================================================================
--
-- Прежние версии сообщения — для модерации: что было сказано до правки.
-- Снимок полный — вид, текст и вложения со всеми полями, — поэтому строки
-- `attachments` при правке заменяются физически: всё, что в них было,
-- остаётся здесь, а файлы в Storage правка не трогает никогда.
--
-- Пользователи таблицу не читают и не пишут: RLS включена, политик нет,
-- права отозваны. Пишет только `edit_message`, читает сервисная роль.

create table public.message_revisions (
  id uuid primary key default gen_random_uuid (),
  message_id uuid not null references public.messages (id) on delete cascade,
  chat_id uuid not null references public.chats (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  kind text not null,
  text text,
  attachments jsonb not null default '[]'::jsonb,
  /** С какого момента эта версия была на экране: создание или прошлая правка. */
  version_at timestamptz not null,
  /** Когда её заменили. */
  created_at timestamptz not null default now()
);

create index message_revisions_message_id_idx
  on public.message_revisions (message_id, created_at);

alter table public.message_revisions enable row level security;

revoke all on public.message_revisions from anon, authenticated;

-- =============================================================================
-- Правка
-- =============================================================================

/**
 * Собирает своё сообщение заново одной транзакцией.
 *
 * `media` — альбом итога по порядку: `{"attachment_id": …}` оставляет
 * имеющееся вложение, объект с `url` и прочими полями — новый файл, уже
 * загруженный в Storage. `voice` — голосовое итога в той же форме. Вид
 * итога следует из содержимого: голосовое → `voice`, есть файлы → `media`,
 * иначе `text`.
 *
 * Security definer: вложения меняются удалением и вставкой, а на это у
 * клиента прав нет. Поэтому автор, участие в чате и всё остальное
 * проверяются здесь явно.
 */
create function public.edit_message(
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

  -- for update: параллельные правка и удаление того же сообщения идут по
  -- очереди, и ревизия снимается с той версии, которую правка заменяет.
  select * into m from public.messages where id = target_message for update;

  if m.id is null or m.deleted_at is not null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if m.author_id is distinct from caller then
    raise exception 'only own messages can be edited' using errcode = '42501';
  end if;

  -- Писать в чат — право участника. Вышедший из чата не дописывает в него и
  -- правкой.
  if not exists (
    select 1 from public.chat_members where chat_id = m.chat_id and user_id = caller
  ) then
    raise exception 'only chat members can edit messages' using errcode = '42501';
  end if;

  if m.kind not in ('text', 'media', 'voice') then
    raise exception 'this message cannot be edited' using errcode = '22023';
  end if;

  if exists (select 1 from public.message_forwards where message_id = m.id) then
    raise exception 'forwarded messages cannot be edited' using errcode = '42501';
  end if;

  -- ------------------------------------------------------------ вид итога
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

  -- Оставленные вложения — только свои, этого сообщения, и каждое один раз.
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

  -- ------------------------------------------------ ничего не изменилось
  -- Повтор той же правки (ответ потерялся по дороге) не плодит ревизий.
  select coalesce(array_agg(url order by position), '{}') into old_urls
  from public.attachments where message_id = m.id;

  select coalesce(
    array_agg(
      coalesce(
        (select a.url from public.attachments a
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

  -- ------------------------------------------------------------- ревизия
  select coalesce(jsonb_agg(to_jsonb(a) order by a.position), '[]'::jsonb) into old_files
  from public.attachments a where a.message_id = m.id;

  insert into public.message_revisions (
    message_id, chat_id, author_id, kind, text, attachments, version_at
  ) values (
    m.id, m.chat_id, m.author_id, m.kind, m.text, old_files, coalesce(m.edited_at, m.created_at)
  );

  -- --------------------------------------------------- замена содержимого
  -- Вложения ссылаются на пару (id, kind) сообщения, поэтому сначала уходят
  -- все, затем меняется вид, затем встают вложения итога. Оставленные — с
  -- прежними id и временем, из снимка: облачко не перерисовывает то, что не
  -- менялось.
  delete from public.attachments where message_id = m.id;

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
        size_bytes, waveform, position, created_at
      ) values (
        kept_row.id, m.id, new_kind, kept_row.url, kept_row.poster_url, kept_row.mime_type,
        kept_row.width, kept_row.height, kept_row.duration_ms, kept_row.size_bytes,
        kept_row.waveform, item_index, kept_row.created_at
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

  -- В альбоме — только картинки и видео: звук в мозаике не нарисовать.
  if new_kind = 'media' and exists (
    select 1 from public.attachments
    where message_id = m.id
      and (mime_type is null or not (mime_type like 'image/%' or mime_type like 'video/%'))
  ) then
    raise exception 'В альбоме только фото и видео' using errcode = 'check_violation';
  end if;

  -- Голосовое без длительности и не-звук отвергнет `attachments_voice_is_audio`,
  -- лишнее вложение — `attachments_single_media`, остальное — проверка формы
  -- в конце транзакции. Здесь — сразу, чтобы ответ клиенту был честным.
  perform public.check_message_shape(m.id);

  -- -------------------------------------------------------------- превью
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

  -- ------------------------------------------------------------ рассылка
  -- Payload — сигнал: облачко клиент перечитывает из базы.
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

revoke execute on function public.edit_message(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.edit_message(uuid, text, jsonb, jsonb) to authenticated;

/**
 * Время правки этих сообщений — чтобы после обрыва Realtime дочитать
 * пропущенные правки: клиент сравнивает с тем, что у него, и перечитывает
 * только изменившиеся. Удалённое не отдаётся — о нём `message_tombstones`.
 */
create function public.message_edits(message_ids uuid[])
returns table (id uuid, edited_at timestamptz)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if cardinality(message_ids) > 1000 then
    raise exception 'too many messages in one call' using errcode = '22023';
  end if;

  return query
    select m.id, m.edited_at
    from public.messages m
    where m.id = any (message_ids) and m.edited_at is not null and m.deleted_at is null;
end;
$$;

revoke execute on function public.message_edits(uuid[]) from public, anon;
grant execute on function public.message_edits(uuid[]) to authenticated;
