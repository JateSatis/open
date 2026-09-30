-- Комментарии к сообщениям.
--
-- Комментарий — то, чем посторонний участвует в чужой публичной переписке, не
-- становясь её участником. Оставить его может любой аутентифицированный, у
-- любого сообщения, во всех чатах, всегда; выключить комментарии нельзя.
--
-- Комментарии никогда не смешиваются с сообщениями: своя таблица, свои
-- вложения, свой топик Realtime. В переписку, превью списка чатов,
-- непрочитанное и уведомления о сообщениях они не попадают — ни одна из
-- этих вещей не читает `comments`.
--
-- Устроено по образцу сообщений: вид (текст, альбом, голосовое), вложения
-- с теми же инвариантами, отправка одной транзакцией, правка с ревизией для
-- модерации, мягкое удаление. Отличие — в праве на запись: участие в чате
-- не проверяется нигде.

-- =============================================================================
-- Счётчик на сообщении
-- =============================================================================
--
-- Денормализованно: число живых комментариев рисует каждое облачко переписки,
-- а лента возьмёт его как сигнал вовлечённости. Пишет только триггер ниже:
-- прямого UPDATE у клиента на `messages` нет с миграции правки.

alter table public.messages
  add column comments_count int not null default 0;

-- =============================================================================
-- comments
-- =============================================================================
--
-- Чат хранится рядом с сообщением, чтобы выбирать и считать по чату, и
-- обязан совпадать с чатом сообщения. Это инвариант схемы — составной
-- внешний ключ на пару (id, chat_id), как у закрепов и ответов: комментарий,
-- приписанный к чужому чату, база не примет, откуда бы ни пришла вставка.
--
-- Ряд — участник или посетитель — ставит база по `chat_members` в момент
-- отправки, как у реакций. Клиент его не выбирает; в интерфейсе это тихая
-- пометка у имени.

create table public.comments (
  id uuid primary key default gen_random_uuid (),
  chat_id uuid not null references public.chats (id) on delete cascade,
  message_id uuid not null,
  author_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('text', 'media', 'voice')),
  text text,
  /** Автор — участник чата или посетитель. Ставит только триггер. */
  audience text not null default 'visitor' check (audience in ('member', 'visitor')),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint comments_id_kind_key unique (id, kind),
  constraint comments_message_fkey
    foreign key (message_id, chat_id) references public.messages (id, chat_id) on delete cascade
);

-- Постраничная выборка панели: комментарии сообщения по времени, живые.
create index comments_message_id_created_at_idx
  on public.comments (message_id, created_at desc)
  where deleted_at is null;

create index comments_chat_id_idx on public.comments (chat_id);
create index comments_author_id_idx on public.comments (author_id);

alter table public.comments enable row level security;

create policy "comments are readable by authenticated users"
  on public.comments for select
  to authenticated
  using (deleted_at is null);

-- Оставить комментарий может любой аутентифицированный — это правило
-- продукта, участие в чате не проверяется. Только от своего имени; время,
-- ряд и живость сообщения ставит и проверяет триггер ниже. Обычный путь —
-- функции `send_comment` и `send_voice_comment`: они вставляют комментарий и
-- его вложения одной транзакцией.
create policy "comments are added by their author"
  on public.comments for insert
  to authenticated
  with check (auth.uid() = author_id);

-- Содержимое меняется и удаляется только функциями `edit_comment` и
-- `delete_comment`, которые сами проверяют автора.
revoke insert, update, delete on public.comments from anon, authenticated;
grant insert (chat_id, message_id, author_id, kind, text) on public.comments to authenticated;

/**
 * Время ставит сервер, сообщение обязано быть живым и не системным, ряд — по
 * участию в чате. `for key share` держит сообщение до конца транзакции:
 * параллельное удаление (`delete_messages` берёт `for update`) ждёт, а если
 * удаление успело раньше, строка читается уже удалённой. С вставкой
 * соседнего комментария блокировка не конфликтует — счётчик обновляет ту же
 * строку без ключевых колонок.
 */
create function public.prepare_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.messages;
begin
  new.created_at := now();
  new.edited_at := null;
  new.deleted_at := null;

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

  -- Чат комментария сверяет внешний ключ; ряд — по чату сообщения.
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

create trigger on_comment_inserted
  before insert on public.comments
  for each row execute function public.prepare_comment();

-- =============================================================================
-- Вложения комментариев
-- =============================================================================
--
-- Отдельная таблица, а не `attachments`: вложения сообщений связаны с
-- `messages` составным ключом (message_id, message_kind), и его нельзя
-- ослабить, не открыв дыру в инвариантах сообщений. Набор метаданных тот же,
-- и те же инварианты, только здесь они сразу CHECK: старых данных нет.

create table public.comment_attachments (
  id uuid primary key default gen_random_uuid (),
  comment_id uuid not null,
  comment_kind text not null,
  url text not null,
  poster_url text,
  mime_type text,
  width int,
  height int,
  duration_ms int,
  size_bytes bigint,
  waveform smallint[],
  position int not null default 0 check (position >= 0 and position < 50),
  created_at timestamptz not null default now(),
  constraint comment_attachments_comment_fkey
    foreign key (comment_id, comment_kind) references public.comments (id, kind) on delete cascade,
  constraint comment_attachments_position_key unique (comment_id, position),
  constraint comment_attachments_waveform_shape check (
    waveform is null
    or (
      array_ndims(waveform) = 1
      and cardinality(waveform) between 1 and 64
      and array_position(waveform, null) is null
      and 0 <= all (waveform)
      and 31 >= all (waveform)
    )
  ),
  -- Голосовое — звук известной длины.
  constraint comment_attachments_voice_is_audio check (
    comment_kind <> 'voice'
    or (
      mime_type is not null
      and mime_type like 'audio/%'
      and duration_ms is not null
      and duration_ms > 0
    )
  ),
  -- В альбоме — только картинки и видео: звук в мозаике не нарисовать.
  constraint comment_attachments_media_is_visual check (
    comment_kind <> 'media'
    or (mime_type is not null and (mime_type like 'image/%' or mime_type like 'video/%'))
  )
);

-- Голосовое — ровно один файл: «не больше одного» держит этот индекс, «не
-- меньше» — проверка формы в конце транзакции.
create unique index comment_attachments_single_voice
  on public.comment_attachments (comment_id)
  where comment_kind = 'voice';

alter table public.comment_attachments enable row level security;

create policy "comment_attachments are readable when their comment is visible"
  on public.comment_attachments for select
  to authenticated
  using (
    exists (
      select 1 from public.comments c
      where c.id = comment_attachments.comment_id
        and c.deleted_at is null
    )
  );

-- Дописать вложение можно только к своему комментарию и только в той
-- транзакции, в которой он создан: время комментария ставит триггер, и оно
-- равно `now()` лишь в ней. Иначе файлы появлялись бы у старого комментария
-- в обход правки — без «изменено» и без ревизии.
create policy "comment_attachments are added by the author when sending"
  on public.comment_attachments for insert
  to authenticated
  with check (
    exists (
      select 1 from public.comments c
      where c.id = comment_attachments.comment_id
        and c.author_id = auth.uid()
        and c.created_at = now()
    )
  );

revoke update, delete on public.comment_attachments from anon, authenticated;
revoke insert on public.comment_attachments from anon;

-- =============================================================================
-- Форма комментария
-- =============================================================================
--
-- Те же правила, что у сообщения (`check_message_shape`): голосовое — один
-- файл без подписи, альбом — хотя бы один файл, текст — непустой и без
-- файлов. Отложенно, в конце транзакции, когда комментарий собран целиком.

create function public.check_comment_shape(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.comments;
  files int;
begin
  select * into c from public.comments where id = target;

  if c.id is null or c.deleted_at is not null then
    return;
  end if;

  select count(*) into files from public.comment_attachments where comment_id = target;

  if c.kind = 'voice' and (files <> 1 or c.text is not null) then
    raise exception 'У голосового комментария должно быть ровно одно вложение и нет подписи'
      using errcode = 'check_violation';
  end if;

  if c.kind = 'media' and files = 0 then
    raise exception 'В альбоме должен быть хотя бы один файл'
      using errcode = 'check_violation';
  end if;

  if c.kind = 'text' and (files > 0 or coalesce(btrim(c.text), '') = '') then
    raise exception 'Текстовый комментарий — непустой текст без вложений'
      using errcode = 'check_violation';
  end if;
end;
$$;

create function public.enforce_comment_shape()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'comment_attachments' then
    perform public.check_comment_shape(coalesce(new.comment_id, old.comment_id));
  else
    perform public.check_comment_shape(new.id);
  end if;

  return null;
end;
$$;

create constraint trigger on_comment_shape_changed
  after insert or update of kind, text on public.comments
  deferrable initially deferred
  for each row execute function public.enforce_comment_shape();

create constraint trigger on_comment_attachments_changed
  after insert or delete on public.comment_attachments
  deferrable initially deferred
  for each row execute function public.enforce_comment_shape();

-- =============================================================================
-- Ревизии
-- =============================================================================
--
-- Прежние версии комментария — для модерации, как `message_revisions`.
-- Пользователи таблицу не читают и не пишут: RLS включена, политик нет.

create table public.comment_revisions (
  id uuid primary key default gen_random_uuid (),
  comment_id uuid not null references public.comments (id) on delete cascade,
  message_id uuid not null,
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

create index comment_revisions_comment_id_idx
  on public.comment_revisions (comment_id, created_at);

alter table public.comment_revisions enable row level security;

revoke all on public.comment_revisions from anon, authenticated;

-- =============================================================================
-- Счётчик и события
-- =============================================================================
--
-- Добавление, удаление и правка — сигналом в топик комментариев сообщения
-- `comments:<message_id>`: его слушает открытая панель, у посетителя тоже.
-- Изменение счётчика — сигналом в топик чата, откуда его пачкой перечитывает
-- переписка, как реакции. Payload — только подсказка: строки клиент всегда
-- читает из базы.

create function public.handle_comment_changed()
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
  end if;

  begin
    perform realtime.send(
      jsonb_build_object('message_id', new.message_id, 'comment_id', new.id),
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

create trigger on_comment_changed
  after insert or update on public.comments
  for each row execute function public.handle_comment_changed();

/**
 * Сообщение, к которому открыта панель, правят или удаляют — панель
 * перерисовывает его сверху или показывает «Сообщение удалено». Сигнал в
 * топик комментариев, а не в топик чата: панель откроется и из ленты, где
 * канала чата нет.
 */
create function public.broadcast_comment_target_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('message_id', new.id),
      'target_changed',
      'comments:' || new.id::text,
      true
    );
  exception
    when others then null;
  end;

  return null;
end;
$$;

create trigger on_message_changed_for_comments
  after update of edited_at, deleted_at on public.messages
  for each row
  when (
    old.deleted_at is distinct from new.deleted_at
    or old.edited_at is distinct from new.edited_at
  )
  execute function public.broadcast_comment_target_changed();

-- Топик комментариев открыт всем аутентифицированным: комментарии публичны,
-- как и переписка. Писать в него клиент не может — события кладёт база.
create policy "comment topics are readable by authenticated users"
  on realtime.messages for select
  to authenticated
  using (realtime.topic() like 'comments:%');

-- =============================================================================
-- Отправка
-- =============================================================================
--
-- Комментарий и его вложения появляются атомарно. Security invoker: вставка
-- идёт под политиками выше — от своего имени, к живому сообщению.

/**
 * Текст или альбом с подписью. Вид следует из содержимого: есть файлы —
 * `media`, иначе `text`. Пустой комментарий отвергнет проверка формы.
 */
create function public.send_comment(
  target_message uuid,
  comment_text text,
  media jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_chat uuid;
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

  -- Удалённое сообщение SELECT-политика не отдаёт.
  select chat_id into target_chat from public.messages where id = target_message;

  if target_chat is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  new_kind := case when jsonb_array_length(media) = 0 then 'text' else 'media' end;

  insert into public.comments (chat_id, message_id, author_id, kind, text)
  values (
    target_chat,
    target_message,
    auth.uid(),
    new_kind,
    nullif(btrim(coalesce(comment_text, '')), '')
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

  return new_id;
end;
$$;

revoke execute on function public.send_comment(uuid, text, jsonb) from public, anon;
grant execute on function public.send_comment(uuid, text, jsonb) to authenticated;

/** Голосовое: один файл-звук с длительностью и волной, без подписи. */
create function public.send_voice_comment(target_message uuid, voice jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_chat uuid;
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

  if voice -> 'waveform' is not null and jsonb_typeof(voice -> 'waveform') = 'array' then
    select array_agg(value::smallint order by ord)
    into bars
    from jsonb_array_elements_text(voice -> 'waveform') with ordinality as t(value, ord);
  end if;

  insert into public.comments (chat_id, message_id, author_id, kind)
  values (target_chat, target_message, auth.uid(), 'voice')
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

  return new_id;
end;
$$;

revoke execute on function public.send_voice_comment(uuid, jsonb) from public, anon;
grant execute on function public.send_voice_comment(uuid, jsonb) to authenticated;

-- =============================================================================
-- Правка
-- =============================================================================

/**
 * Собирает свой комментарий заново одной транзакцией — как `edit_message`:
 * `media` — альбом итога по порядку (`{"attachment_id": …}` оставляет
 * имеющийся файл, объект с `url` — новый), `voice` — голосовое итога. Вид
 * итога следует из содержимого. Прежняя версия уходит в `comment_revisions`.
 *
 * Security definer: вложения меняются удалением и вставкой, а на это у
 * клиента прав нет. Автор проверяется здесь явно. К удалённому сообщению
 * комментарии не принимаются — и правкой тоже.
 */
create function public.edit_comment(
  target_comment uuid,
  comment_text text,
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
  c public.comments;
  old_files jsonb;
  new_text text := nullif(btrim(coalesce(comment_text, '')), '');
  new_kind text;
  items jsonb;
  item jsonb;
  item_index int := 0;
  kept uuid;
  kept_row public.comment_attachments;
  bars smallint[];
  new_urls text[] := '{}';
  old_urls text[];
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

  -- for update: параллельные правка и удаление идут по очереди, и ревизия
  -- снимается с той версии, которую правка заменяет.
  select * into c from public.comments where id = target_comment for update;

  if c.id is null or c.deleted_at is not null then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;

  if c.author_id is distinct from caller then
    raise exception 'only own comments can be edited' using errcode = '42501';
  end if;

  perform 1 from public.messages
  where id = c.message_id and deleted_at is null
  for key share;

  if not found then
    raise exception 'message not found' using errcode = 'P0002';
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
    raise exception 'Пустой комментарий сохранить нельзя' using errcode = 'check_violation';
  end if;

  -- Оставленные вложения — только свои, этого комментария, и каждое один раз.
  if exists (
    select 1
    from jsonb_array_elements(items) as i(value)
    where i.value ? 'attachment_id'
      and not exists (
        select 1 from public.comment_attachments a
        where a.comment_id = c.id and a.id::text = i.value ->> 'attachment_id'
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
  select coalesce(array_agg(url order by position), '{}') into old_urls
  from public.comment_attachments where comment_id = c.id;

  select coalesce(
    array_agg(
      coalesce(
        (select a.url from public.comment_attachments a
         where a.comment_id = c.id and a.id::text = i.value ->> 'attachment_id'),
        i.value ->> 'url'
      )
      order by i.ord
    ),
    '{}'
  )
  into new_urls
  from jsonb_array_elements(items) with ordinality as i(value, ord);

  if new_kind = c.kind and new_text is not distinct from c.text and new_urls = old_urls then
    return;
  end if;

  -- ------------------------------------------------------------- ревизия
  select coalesce(jsonb_agg(to_jsonb(a) order by a.position), '[]'::jsonb) into old_files
  from public.comment_attachments a where a.comment_id = c.id;

  insert into public.comment_revisions (
    comment_id, message_id, chat_id, author_id, kind, text, attachments, version_at
  ) values (
    c.id, c.message_id, c.chat_id, c.author_id, c.kind, c.text, old_files,
    coalesce(c.edited_at, c.created_at)
  );

  -- --------------------------------------------------- замена содержимого
  -- Вложения ссылаются на пару (id, kind) комментария: сначала уходят все,
  -- затем меняется вид, затем встают вложения итога — оставленные с прежними
  -- id и временем.
  delete from public.comment_attachments where comment_id = c.id;

  update public.comments
  set kind = new_kind, text = new_text, edited_at = now()
  where id = c.id;

  for item in select value from jsonb_array_elements(items)
  loop
    if item ? 'attachment_id' then
      kept := (item ->> 'attachment_id')::uuid;

      select * into kept_row
      from jsonb_populate_recordset(null::public.comment_attachments, old_files)
      where id = kept;

      insert into public.comment_attachments (
        id, comment_id, comment_kind, url, poster_url, mime_type, width, height, duration_ms,
        size_bytes, waveform, position, created_at
      ) values (
        kept_row.id, c.id, new_kind, kept_row.url, kept_row.poster_url, kept_row.mime_type,
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

      insert into public.comment_attachments (
        comment_id, comment_kind, url, poster_url, mime_type, width, height, duration_ms,
        size_bytes, waveform, position
      ) values (
        c.id,
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

  -- Остальное отвергнут CHECK вложений и проверка формы в конце транзакции;
  -- здесь — сразу, чтобы ответ клиенту был честным.
  perform public.check_comment_shape(c.id);
end;
$$;

revoke execute on function public.edit_comment(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.edit_comment(uuid, text, jsonb, jsonb) to authenticated;

-- =============================================================================
-- Удаление
-- =============================================================================

/**
 * Удаляет свой комментарий для всех — мягко. Повтор не ошибка. Security
 * definer: Postgres не даёт обновить строку так, чтобы она перестала быть
 * видимой по SELECT-политике, поэтому удаление идёт функцией с явной
 * проверкой автора.
 */
create function public.delete_comment(target_comment uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  c public.comments;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into c from public.comments where id = target_comment for update;

  if c.id is null then
    raise exception 'comment not found' using errcode = 'P0002';
  end if;

  if c.author_id is distinct from caller then
    raise exception 'only own comments can be deleted' using errcode = '42501';
  end if;

  if c.deleted_at is not null then
    return;
  end if;

  update public.comments set deleted_at = now() where id = c.id;
end;
$$;

revoke execute on function public.delete_comment(uuid) from public, anon;
grant execute on function public.delete_comment(uuid) to authenticated;

-- Служебное — не для прямого вызова.
revoke execute on function public.prepare_comment() from public, anon, authenticated;
revoke execute on function public.check_comment_shape(uuid) from public, anon, authenticated;
revoke execute on function public.enforce_comment_shape() from public, anon, authenticated;
revoke execute on function public.handle_comment_changed() from public, anon, authenticated;
revoke execute on function public.broadcast_comment_target_changed() from public, anon, authenticated;
