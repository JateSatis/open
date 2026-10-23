-- Приватность, этап 6: скрытый текст и задержка публикации для зрителей — схема.
--
-- Скрытый текст. Автор помечает куски текста своего сообщения: участники
-- чата видят оригинал, все остальные — «замазку». Хранится диапазонами
-- `[start, end)` в code points (`messages.hidden_ranges`, int4multirange:
-- пересечения склеиваются сами). Текст для зрителей — `messages.public_text`,
-- вычисляемая колонка: каждый символ скрытого диапазона, включая пробелы и
-- переносы, заменён одним «•». Длина в code points та же, что у оригинала,
-- — смещения фрагментов и кластеров у зрителя и участника совпадают, а
-- структура слов не раскрывается. Оригинал зрителю не уходит ни в каком
-- поле: выборки, поиск, превью и рассылки берут `public_text`, если
-- смотрящий не участник (функции — в следующих миграциях).
--
-- Задержка. У владельца с включённой `public_message_visibility_delay`
-- сообщение в личке или группе ждёт случайные 1–30 минут
-- (`messages.delayed_until`), и всё, что в этом чате написано после него,
-- зрители видят не раньше: `messages.public_at` — когда сообщение видят
-- зрители — не меньше, чем у любого ещё не опубликованного перед ним.
-- Водораздел чата — `chat_public_hold`: номер самого раннего живого
-- неопубликованного сообщения; зрителю отдаются только сообщения строго
-- ниже него. Участники видят всё сразу. Фактическое `created_at` не меняется.
--
-- Настройка «Скрытый текст» (`dialogue_hidden_text_visibility`) убрана:
-- скрывать части своих сообщений может каждый, это правило, а не настройка.

-- =============================================================================
-- Настройки: скрытый текст — не настройка
-- =============================================================================

alter table public.privacy_settings drop column dialogue_hidden_text_visibility;

create or replace function public.privacy_default_settings(p_minor boolean)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case when p_minor then jsonb_build_object(
    'profile_identity_masking', 'friends',
    'dialogue_participant_name_masking', 'friends',
    'activity_status_visibility', 'friends',
    'avatar_visibility', 'friends',
    'message_activity_metadata_visibility', 'friends',
    'account_search_visibility', 'friends',
    'dialogue_media_visibility', 'friends',
    'friends_list_visibility', 'nobody',
    'public_message_visibility_delay', 'random_delay'
  ) else jsonb_build_object(
    'profile_identity_masking', 'everyone',
    'dialogue_participant_name_masking', 'everyone',
    'activity_status_visibility', 'everyone',
    'avatar_visibility', 'everyone',
    'message_activity_metadata_visibility', 'everyone',
    'account_search_visibility', 'everyone',
    'dialogue_media_visibility', 'everyone',
    'friends_list_visibility', 'everyone',
    'public_message_visibility_delay', 'off'
  ) end
$$;

-- =============================================================================
-- Скрытый текст
-- =============================================================================

/** Текст для зрителей: каждый символ скрытых диапазонов — «•». */
create or replace function public.mask_hidden_text(body text, ranges int4multirange)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  r int4range;
  result text := body;
begin
  if body is null or ranges is null or isempty(ranges) then
    return body;
  end if;

  for r in select unnest(ranges)
  loop
    result := overlay(
      result placing repeat('•', upper(r) - lower(r)) from lower(r) + 1 for upper(r) - lower(r)
    );
  end loop;

  return result;
end;
$$;

alter table public.messages
  add column hidden_ranges int4multirange not null default '{}'::int4multirange;

alter table public.messages
  add column public_text text generated always as (public.mask_hidden_text(text, hidden_ranges)) stored;

-- Инвариант: скрытое — только внутри текста, только у сообщений с текстом.
-- Пересечений нет по устройству мультидиапазона.
alter table public.messages
  add constraint messages_hidden_ranges_in_text check (
    isempty(hidden_ranges)
    or (
      kind in ('text', 'media')
      and text is not null
      and not lower_inf(hidden_ranges)
      and not upper_inf(hidden_ranges)
      and lower(hidden_ranges) >= 0
      and upper(hidden_ranges) <= char_length(text)
    )
  );

comment on column public.messages.hidden_ranges is
  'Куски текста, скрытые автором от зрителей: [start, end) в code points. Пишут только функции отправки и правки и set_message_hidden.';
comment on column public.messages.public_text is
  'Текст глазами не-участника: скрытые символы заменены «•». Вычисляется из text и hidden_ranges.';

-- Поиск не-участников идёт по тексту для зрителей.
create index messages_search_public_tsv_idx on public.messages
  using gin (public.search_tsv(public_text))
  where deleted_at is null and kind in ('text', 'media') and public_text is not null;

create index messages_search_public_trgm_idx on public.messages
  using gin (public.search_norm(public_text) extensions.gin_trgm_ops)
  where deleted_at is null and kind in ('text', 'media') and public_text is not null;

/** Диапазоны для клиента: `[[start, end], …]` по возрастанию. */
create or replace function public.hidden_ranges_json(ranges int4multirange)
returns jsonb
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(jsonb_build_array(lower(r), upper(r)) order by lower(r)),
    '[]'::jsonb
  )
  from unnest(coalesce(ranges, '{}'::int4multirange)) r
$$;

/**
 * Диапазоны от клиента: `[[start, end], …]`. Пересекающиеся и соседние
 * склеиваются; границы текста проверяет CHECK на сообщении.
 */
create or replace function public.hidden_ranges_from_json(value jsonb)
returns int4multirange
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
  result int4multirange := '{}'::int4multirange;
  range_start int;
  range_end int;
begin
  if value is null or jsonb_typeof(value) = 'null' then
    return result;
  end if;

  if jsonb_typeof(value) <> 'array' then
    raise exception 'Скрытый текст — массив диапазонов' using errcode = '22023';
  end if;

  if jsonb_array_length(value) > 500 then
    raise exception 'Слишком много скрытых кусков' using errcode = '22023';
  end if;

  for item in select v from jsonb_array_elements(value) v
  loop
    if jsonb_typeof(item) <> 'array' or jsonb_array_length(item) <> 2
      or jsonb_typeof(item -> 0) <> 'number' or jsonb_typeof(item -> 1) <> 'number'
    then
      raise exception 'Диапазон скрытого текста — пара чисел' using errcode = '22023';
    end if;

    range_start := (item ->> 0)::int;
    range_end := (item ->> 1)::int;

    if range_start < 0 or range_end <= range_start then
      raise exception 'Пустой или перевёрнутый диапазон скрытого текста' using errcode = '22023';
    end if;

    result := result + int4multirange(int4range(range_start, range_end));
  end loop;

  return result;
end;
$$;

-- =============================================================================
-- Задержка публикации для зрителей
-- =============================================================================

alter table public.messages
  add column delayed_until timestamptz,
  add column public_at timestamptz;

update public.messages set public_at = created_at;

alter table public.messages
  alter column public_at set not null,
  alter column public_at set default now();

comment on column public.messages.delayed_until is
  'Своя задержка сообщения владельца с public_message_visibility_delay: до какого времени его не видят зрители. Ставит триггер.';
comment on column public.messages.public_at is
  'Когда сообщение видят зрители: не раньше своей задержки и не раньше любого неопубликованного перед ним в чате. Ставит триггер.';

-- Неопубликованные — среди задержанных; индекс по ним маленький: из него
-- водораздел берёт `public_at > now()`.
create index messages_chat_delayed_idx on public.messages (chat_id, public_at)
  where deleted_at is null and public_at > created_at;

alter table public.chats add column public_hold_seq bigint;

comment on column public.chats.public_hold_seq is
  'Последний известный водораздел: с какого номера сообщения зрители ещё не видят. Ведут рассылка нового сообщения и задача release_public_messages; читать — только chat_public_hold.';

create index chats_public_hold_idx on public.chats (id) where public_hold_seq is not null;

/** Случайная задержка 1–30 минут, в секундах. Криптографический источник, не `random()`. */
create or replace function public.random_publish_delay_seconds()
returns int
language sql
volatile
set search_path = ''
as $$
  select 60 + (('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1741)::int
$$;

revoke execute on function public.random_publish_delay_seconds() from public, anon, authenticated;

/**
 * Время публикации нового сообщения. Задержка — только у сообщений владельца
 * с включённой настройкой в личке или группе; в любом таком чате новое
 * сообщение ждёт ещё и все неопубликованные перед ним. Значение от клиента
 * не принимается.
 */
create or replace function public.assign_message_public_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chat_kind text;
  pending_until timestamptz;
begin
  new.delayed_until := null;
  new.public_at := now();

  select c.kind into chat_kind from public.chats c where c.id = new.chat_id;

  if chat_kind not in ('direct', 'group') then
    return new;
  end if;

  if new.kind <> 'system'
    and new.author_id is not null
    and exists (
      select 1 from public.privacy_settings s
      where s.user_id = new.author_id and s.public_message_visibility_delay = 'random_delay'
    )
  then
    new.delayed_until := now() + make_interval(secs => public.random_publish_delay_seconds());
  end if;

  select max(m.public_at) into pending_until
  from public.messages m
  where m.chat_id = new.chat_id
    and m.deleted_at is null
    and m.public_at > m.created_at
    and m.public_at > now();

  new.public_at := greatest(now(), new.delayed_until, pending_until);

  return new;
end;
$$;

create trigger messages_assign_public_at
  before insert on public.messages
  for each row execute function public.assign_message_public_at();

/**
 * Водораздел чата: номер самого раннего живого неопубликованного сообщения.
 * Зрителю видны только сообщения строго ниже; `null` — видно всё.
 * Проверка при чтении: удалённые и наступившие водораздел не держат.
 */
create or replace function public.chat_public_hold(p_chat uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select min(m.seq)
  from public.messages m
  where m.chat_id = p_chat
    and m.deleted_at is null
    and m.public_at > m.created_at
    and m.public_at > now()
$$;

/** Как смотрящий видит чат: участник ли он и водораздел для него (`null` — всё). */
create or replace function public.chat_seen(p_chat uuid, p_viewer uuid)
returns table (member boolean, hold bigint)
language plpgsql
stable
security definer
rows 1
set search_path = public
as $$
begin
  member := p_viewer is not null and exists (
    select 1 from public.chat_members cm where cm.chat_id = p_chat and cm.user_id = p_viewer
  );
  hold := case when member then null else public.chat_public_hold(p_chat) end;

  return next;
end;
$$;

/** Видно ли смотрящему сообщение с этим номером: участнику — всё, остальным — ниже водораздела. */
create or replace function public.message_seq_seen(p_chat uuid, p_seq bigint, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
      select 1 from public.chat_members cm where cm.chat_id = p_chat and cm.user_id = p_viewer
    )
    or not exists (
      select 1 from public.messages m
      where m.chat_id = p_chat
        and m.deleted_at is null
        and m.public_at > m.created_at
        and m.public_at > now()
        and m.seq <= p_seq
    )
$$;

/**
 * Как смотрящий видит это сообщение: участник ли он его чата и видно ли оно
 * ему вообще (ниже водораздела). Ключ — id строки: клиент может звать функцию
 * и сам (представления и политики зовут её с его правами), но узнает только
 * про сообщение, id которого уже знает, а водораздела не узнает вовсе.
 */
create or replace function public.message_seen(p_message uuid)
returns table (member boolean, seen boolean)
language plpgsql
stable
security definer
rows 1
set search_path = public
as $$
declare
  me uuid := auth.uid();
  target_chat uuid;
  target_seq bigint;
begin
  select m.chat_id, m.seq into target_chat, target_seq from public.messages m where m.id = p_message;

  member := me is not null and exists (
    select 1 from public.chat_members cm where cm.chat_id = target_chat and cm.user_id = me
  );
  seen := target_chat is not null and (member or public.message_seq_seen(target_chat, target_seq, null));

  return next;
end;
$$;

/**
 * Текст сообщения глазами смотрящего: участнику чата — оригинал, остальным
 * — с замазанным скрытым. Единственное место, где выбирается между ними.
 */
create or replace function public.message_seen_text(body text, public_body text, p_member boolean)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when p_member then body else coalesce(public_body, body) end
$$;

/**
 * Топик сигнала о сообщении: опубликованное — в общий `chat:<id>`, ещё нет
 * — только участникам, в `chat-members:<id>`. Зрители перечитают после
 * публикации.
 */
create or replace function public.message_signal_topic(p_chat uuid, p_seq bigint)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_seq is not null and p_seq >= coalesce(public.chat_public_hold(p_chat), p_seq + 1)
      then 'chat-members:'
    else 'chat:'
  end || p_chat::text
$$;

/** Топик сигнала о чате в целом: пока есть неопубликованное — только участникам. */
create or replace function public.chat_signal_topic(p_chat uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when public.chat_public_hold(p_chat) is not null then 'chat-members:' else 'chat:' end
    || p_chat::text
$$;

-- Водораздел клиенту не отдаётся ни прямо, ни пробой номеров: только
-- `message_seen` по id известного сообщения.
revoke execute on function public.chat_seen(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.message_seq_seen(uuid, bigint, uuid) from public, anon, authenticated;
revoke execute on function public.message_seen(uuid) from public, anon;
grant execute on function public.message_seen(uuid) to authenticated;
revoke execute on function public.chat_public_hold(uuid) from public, anon, authenticated;
revoke execute on function public.message_signal_topic(uuid, bigint) from public, anon, authenticated;
revoke execute on function public.chat_signal_topic(uuid) from public, anon, authenticated;
