-- Приватность, этап 4: псевдонимы и «как показать человека».
--
-- Три настройки начинают работать: «Кто видит моё имя и username»
-- (`profile_identity_masking`), «Кто видит моё имя в моих диалогах»
-- (`dialogue_participant_name_masking`) и «Кто видит мою фотографию»
-- (`avatar_visibility`). Тот, от кого человек закрыт, видит вместо имени
-- правдоподобный псевдоним, не видит username, «О себе» и статуса, а вместо
-- фото — заглушку.
--
-- Здесь — ядро:
--   * словари и генератор псевдонимов («Илья Муромцев», род согласован);
--   * общий псевдоним человека — колонка `privacy_settings.identity_alias`,
--     сменить — `regenerate_identity_alias` (5 раз за сутки, OPN13);
--   * псевдоним и непрозрачный id человека в диалоге — детерминированно из
--     пары (чат, человек) и серверного секрета (`identity_secret`), без
--     хранения: стабилен на всю историю чата и разный в разных чатах;
--   * `person_card(человек, зритель, чат)` — единственное место, где решается,
--     каким человек показан зрителю. Её зовут все функции, представления и
--     рассылки, отдающие людей; клиенту она закрыта (иначе по настоящему id и
--     догадке о чате можно было бы проверить, участник ли человек в чате);
--   * `profile_cards(ids)` — люди глазами смотрящего вне диалогов, для клиента;
--   * колонки `profiles` с именем, username, фото, «О себе» и статусом
--     закрыты от прямого чтения.

-- =============================================================================
-- Секрет псевдонимов и непрозрачных id
-- =============================================================================

create table public.identity_secret (
  id uuid primary key default gen_random_uuid (),
  secret bytea not null default extensions.gen_random_bytes(32),
  created_at timestamptz not null default now()
);

-- Ровно одна строка.
create unique index identity_secret_single_idx on public.identity_secret ((true));

alter table public.identity_secret enable row level security;
revoke all on public.identity_secret from anon, authenticated;

insert into public.identity_secret default values;

/** HMAC-SHA256 сообщения на серверном секрете. */
create function public.identity_hmac(p_message text)
returns bytea
language sql
stable
security definer
set search_path = public
as $$
  select extensions.hmac(convert_to(p_message, 'UTF8'), (select s.secret from public.identity_secret s limit 1), 'sha256')
$$;

-- =============================================================================
-- Словари
-- =============================================================================
--
-- Имена и фамилии — обычные, без редких и узнаваемых. Женская фамилия
-- выводится из мужской (`alias_feminine_surname`), поэтому в словаре фамилий
-- только те, что склоняются по правилу: -ов/-ев/-ёв/-ин/-ын → +а,
-- -ский/-цкий → -ская/-цкая. Совпадение псевдонима с чьим-то настоящим
-- именем допустимо.

create function public.alias_male_names()
returns text[]
language sql
immutable
parallel safe
as $$
  select array[
    'Александр', 'Алексей', 'Андрей', 'Антон', 'Аркадий', 'Арсений', 'Артём', 'Богдан',
    'Борис', 'Вадим', 'Валентин', 'Валерий', 'Василий', 'Виктор', 'Виталий', 'Владимир',
    'Владислав', 'Всеволод', 'Вячеслав', 'Геннадий', 'Георгий', 'Глеб', 'Григорий', 'Даниил',
    'Денис', 'Дмитрий', 'Евгений', 'Егор', 'Захар', 'Иван', 'Игорь', 'Илья',
    'Кирилл', 'Константин', 'Лев', 'Леонид', 'Макар', 'Максим', 'Марк', 'Матвей',
    'Михаил', 'Никита', 'Николай', 'Олег', 'Павел', 'Пётр', 'Роман', 'Руслан',
    'Савелий', 'Святослав', 'Семён', 'Сергей', 'Станислав', 'Степан', 'Тимофей', 'Тимур',
    'Фёдор', 'Филипп', 'Юрий', 'Ярослав'
  ]
$$;

create function public.alias_female_names()
returns text[]
language sql
immutable
parallel safe
as $$
  select array[
    'Агата', 'Александра', 'Алина', 'Алиса', 'Анастасия', 'Ангелина', 'Анна', 'Арина',
    'Валентина', 'Валерия', 'Варвара', 'Василиса', 'Вера', 'Вероника', 'Виктория', 'Галина',
    'Дарья', 'Диана', 'Ева', 'Евгения', 'Екатерина', 'Елена', 'Елизавета', 'Есения',
    'Жанна', 'Злата', 'Зоя', 'Инна', 'Ирина', 'Карина', 'Кира', 'Ксения',
    'Лариса', 'Лидия', 'Любовь', 'Людмила', 'Маргарита', 'Марина', 'Мария', 'Милана',
    'Мирослава', 'Надежда', 'Наталья', 'Нина', 'Оксана', 'Олеся', 'Ольга', 'Полина',
    'Раиса', 'Светлана', 'София', 'Стефания', 'Таисия', 'Тамара', 'Татьяна', 'Ульяна',
    'Эмилия', 'Юлия', 'Яна', 'Ярослава'
  ]
$$;

create function public.alias_surnames()
returns text[]
language sql
immutable
parallel safe
as $$
  select array[
    'Абрамов', 'Агеев', 'Акимов', 'Александров', 'Андреев', 'Антонов', 'Архипов', 'Афанасьев',
    'Баранов', 'Белов', 'Белозёров', 'Белоусов', 'Беляев', 'Блинов', 'Богданов', 'Борисов',
    'Быков', 'Васильев', 'Веселов', 'Виноградов', 'Вишневский', 'Воробьёв', 'Воронин', 'Гаврилов',
    'Голубев', 'Гончаров', 'Горбунов', 'Григорьев', 'Гусев', 'Давыдов', 'Данилов', 'Дмитриев',
    'Добрынин', 'Дубровский', 'Егоров', 'Ершов', 'Ефимов', 'Жуков', 'Зайцев', 'Захаров',
    'Звягинцев', 'Зимин', 'Зуев', 'Иванов', 'Игнатов', 'Ильин', 'Калинин', 'Карпов',
    'Каштанов', 'Кедров', 'Киселёв', 'Климов', 'Ковалёв', 'Ковальский', 'Козлов', 'Колесников',
    'Комаров', 'Королёв', 'Котов', 'Крылов', 'Кудрявцев', 'Кузнецов', 'Кузьмин', 'Лазарев',
    'Лапин', 'Лебедев', 'Макаров', 'Максимов', 'Медведев', 'Мельников', 'Миронов', 'Михайлов',
    'Морозов', 'Муромцев', 'Назаров', 'Никитин', 'Николаев', 'Новиков', 'Орлов', 'Осипов',
    'Островский', 'Павлов', 'Панов', 'Петров', 'Платонов', 'Покровский', 'Поляков', 'Попов',
    'Прохоров', 'Романов', 'Рыбаков', 'Савельев', 'Сазонов', 'Самойлов', 'Седов', 'Селиванов',
    'Семёнов', 'Сергеев', 'Симонов', 'Смирнов', 'Снегирёв', 'Соболев', 'Соколов', 'Соловьёв',
    'Сорокин', 'Степанов', 'Субботин', 'Суханов', 'Тарасов', 'Тимофеев', 'Титов', 'Тихонов',
    'Третьяков', 'Троицкий', 'Успенский', 'Устинов', 'Федотов', 'Филиппов', 'Фомин', 'Фролов',
    'Харитонов', 'Чернов', 'Шарапов', 'Шестаков', 'Широков', 'Щербаков', 'Юдин', 'Яблонский',
    'Яковлев', 'Ястребов'
  ]
$$;

create function public.alias_feminine_surname(p_surname text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p_surname ~ '(ский|цкий)$' then left(p_surname, -2) || 'ая'
    when p_surname ~ '(ов|ев|ёв|ин|ын)$' then p_surname || 'а'
    else p_surname
  end
$$;

/**
 * Псевдоним из байтов: род, имя и фамилия выбираются по разным байтам, так
 * что один и тот же источник даёт одно и то же имя.
 */
create function public.alias_compose(p_seed bytea)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  female boolean := (get_byte(p_seed, 0) & 1) = 1;
  first_names text[] := case when female then public.alias_female_names() else public.alias_male_names() end;
  surnames text[] := public.alias_surnames();
  first_at int := ((get_byte(p_seed, 1) << 8) | get_byte(p_seed, 2)) % cardinality(first_names) + 1;
  last_at int := ((get_byte(p_seed, 3) << 8) | get_byte(p_seed, 4)) % cardinality(surnames) + 1;
begin
  return first_names[first_at] || ' ' || case
    when female then public.alias_feminine_surname(surnames[last_at])
    else surnames[last_at]
  end;
end;
$$;

create function public.alias_random()
returns text
language sql
volatile
as $$
  select public.alias_compose(extensions.gen_random_bytes(8))
$$;

-- =============================================================================
-- Общий псевдоним
-- =============================================================================

alter table public.privacy_settings
  add column identity_alias text,
  -- Окно лимита смены: начало и сколько смен в нём.
  add column alias_window_started_at timestamptz,
  add column alias_window_changes int not null default 0;

create function public.fill_identity_alias()
returns trigger
language plpgsql
as $$
begin
  if new.identity_alias is null then
    new.identity_alias := public.alias_random();
  end if;

  new.alias_window_changes := coalesce(new.alias_window_changes, 0);

  return new;
end;
$$;

-- `privacy_settings_row` собирает строку из набора значений и ставит в
-- псевдоним и счётчик null — их дописывает триггер.
create trigger privacy_settings_fill_identity_alias
  before insert on public.privacy_settings
  for each row execute function public.fill_identity_alias();

update public.privacy_settings set identity_alias = public.alias_random() where identity_alias is null;

alter table public.privacy_settings
  alter column identity_alias set not null,
  add constraint privacy_settings_identity_alias_length check (char_length(identity_alias) between 3 and 64);

-- Поиск человека по псевдониму — тем, от кого скрыто имя.
create index privacy_settings_alias_search_idx
  on public.privacy_settings using gin (public.search_norm(identity_alias) extensions.gin_trgm_ops);

/**
 * Новый случайный псевдоним. Свой не вводится. Лимит — 5 смен за сутки,
 * считая от первой смены в окне (OPN13). Старый перестаёт находиться сразу:
 * он нигде не хранится.
 */
create function public.regenerate_identity_alias()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  row public.privacy_settings;
  fresh text;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  select * into row from public.privacy_settings where user_id = me for update;

  if not found then
    raise exception 'Настройки не найдены' using errcode = 'P0002';
  end if;

  if row.alias_window_started_at is not null
    and row.alias_window_started_at > now() - interval '1 day'
    and row.alias_window_changes >= 5
  then
    raise exception 'Псевдоним можно сменить не больше 5 раз в сутки' using errcode = 'OPN13';
  end if;

  for attempt in 1..10 loop
    fresh := public.alias_random();
    exit when fresh <> row.identity_alias;
  end loop;

  update public.privacy_settings
  set
    identity_alias = fresh,
    alias_window_started_at = case
      when alias_window_started_at is null or alias_window_started_at <= now() - interval '1 day' then now()
      else alias_window_started_at
    end,
    alias_window_changes = case
      when alias_window_started_at is null or alias_window_started_at <= now() - interval '1 day' then 1
      else alias_window_changes + 1
    end,
    updated_at = now()
  where user_id = me;

  return fresh;
end;
$$;

-- =============================================================================
-- Человек в диалоге: псевдоним и непрозрачный id
-- =============================================================================

/**
 * Участник ли человек чата — сейчас или когда-то: писал в нём (в том числе
 * системные строки «вступил», «ушёл») или его звали. Ушедший остаётся под
 * тем же псевдонимом в истории, а позванный — под тем же, что будет у него
 * после вступления: иначе по «ещё не принял» и новому участнику их можно было
 * бы связать.
 */
create index messages_chat_author_idx on public.messages (chat_id, author_id) where author_id is not null;

create function public.chat_participant(p_chat uuid, p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.chat_members where chat_id = p_chat and user_id = p_person)
    or exists (select 1 from public.chat_invites where chat_id = p_chat and invitee_id = p_person)
    or exists (select 1 from public.messages where chat_id = p_chat and author_id = p_person)
$$;

/** Непрозрачный id человека в чате: не совпадает между чатами, не ведёт к профилю. */
create function public.chat_opaque_id(p_chat uuid, p_person uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select encode(substring(public.identity_hmac('opaque:' || p_chat || ':' || p_person) from 1 for 16), 'hex')::uuid
$$;

/** Псевдоним человека в чате. Не совпадает с его общим псевдонимом. */
create function public.chat_alias(p_chat uuid, p_person uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  general text;
  candidate text;
begin
  select identity_alias into general from public.privacy_settings where user_id = p_person;

  for attempt in 0..5 loop
    candidate := public.alias_compose(public.identity_hmac('alias:' || p_chat || ':' || p_person || ':' || attempt));
    exit when candidate is distinct from general;
  end loop;

  return candidate;
end;
$$;

/**
 * Видит ли зритель настоящее по одной из настроек идентичности. Как
 * `privacy_allows`, но блокировка скрывает только в одну сторону: тот, кто
 * заблокировал смотрящего (или аккаунт его устройства), — «не видно»; а
 * заблокированного смотрящий видит по его же настройке (друзьями они уже не
 * будут). Иначе «Заблокированные» показывали бы псевдонимы даже тех, кто
 * открыт всем.
 */
create function public.identity_allows(p_value text, p_person uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (p_viewer is not null and p_viewer = p_person) or (
    not public.is_blocked_by(p_viewer, p_person)
    and (
      p_value = 'everyone'
      or (p_value = 'friends' and p_viewer is not null and public.are_friends(p_person, p_viewer))
    )
  )
$$;

/**
 * Подменён ли человек для зрителя в контексте чата: диалог (личка или
 * группа), человек — его участник, зритель — нет, а настройка «Кто видит моё
 * имя в моих диалогах» зрителю закрыта. Участникам чата человек виден по
 * профильной настройке, посторонним в чужом чате — не по ней.
 */
create function public.dialogue_masked(p_person uuid, p_viewer uuid, p_chat uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_chat is not null
    and p_person is not null
    and p_viewer is distinct from p_person
    and exists (select 1 from public.chats c where c.id = p_chat and c.kind in ('direct', 'group'))
    and not exists (select 1 from public.chat_members where chat_id = p_chat and user_id = p_viewer)
    and not public.identity_allows(
      (select s.dialogue_participant_name_masking from public.privacy_settings s where s.user_id = p_person),
      p_person,
      p_viewer
    )
    and public.chat_participant(p_chat, p_person)
$$;

/** Id человека глазами зрителя в чате: настоящий или непрозрачный. Без имени — где нужен только id. */
create function public.person_shown_id(p_person uuid, p_viewer uuid, p_chat uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.dialogue_masked(p_person, p_viewer, p_chat) then public.chat_opaque_id(p_chat, p_person)
    else p_person
  end
$$;

-- =============================================================================
-- Как показать человека
-- =============================================================================

create type public.person_card as (
  -- Настоящий id или, если человек подменён в диалоге, непрозрачный id чата.
  id uuid,
  display_name text,
  username text,
  avatar_url text,
  bio text,
  status text,
  -- Имя подменено псевдонимом.
  masked boolean,
  -- Id непрозрачный: профиля за ним нет.
  opaque boolean
);

/**
 * Каким человек `p_person` показан зрителю `p_viewer` в контексте чата
 * `p_chat` (null — вне диалогов: профиль, поиск, друзья). Единственное
 * место, где применяются три настройки идентичности.
 *
 *  * Сам себе — всё настоящее.
 *  * Диалог (личка или группа), где человек участник, а зритель — нет, и
 *    `dialogue_participant_name_masking` зрителю закрыта: псевдоним этого
 *    чата и непрозрачный id, без username, фото и «О себе». Сильнее
 *    профильной настройки.
 *  * Иначе — профильная: закрыта `profile_identity_masking` — общий
 *    псевдоним без username, «О себе» и статуса; закрыта `avatar_visibility`
 *    — без фото. Id настоящий: профиль открывается, но под псевдонимом.
 *
 * Видимость — `identity_allows`: `friends` — только взаимные друзья, тот,
 * кто заблокировал смотрящего, — «не видно».
 *
 * Удалённый аккаунт — null.
 */
create function public.person_card(p_person uuid, p_viewer uuid, p_chat uuid)
returns public.person_card
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.profiles;
  s public.privacy_settings;
  name_ok boolean;
  avatar_ok boolean;
  card public.person_card;
begin
  if p_person is null then
    return null;
  end if;

  select * into p from public.profiles where id = p_person;

  if not found or p.deleted_at is not null then
    return null;
  end if;

  if p_viewer is not null and p_viewer = p_person then
    card := row(p.id, p.display_name, p.username, p.avatar_url, p.bio, p.status, false, false);
    return card;
  end if;

  select * into s from public.privacy_settings where user_id = p_person;

  -- Открыт всем — самый частый случай: без проверки дружбы и участия.
  if s.profile_identity_masking = 'everyone'
    and s.avatar_visibility = 'everyone'
    and (p_chat is null or s.dialogue_participant_name_masking = 'everyone')
    and not public.is_blocked_by(p_viewer, p_person)
  then
    card := row(p.id, p.display_name, p.username, p.avatar_url, p.bio, p.status, false, false);
    return card;
  end if;

  if public.dialogue_masked(p_person, p_viewer, p_chat) then
    card := row(
      public.chat_opaque_id(p_chat, p_person),
      public.chat_alias(p_chat, p_person),
      null, null, null, null, true, true
    );
    return card;
  end if;

  name_ok := coalesce(public.identity_allows(s.profile_identity_masking, p_person, p_viewer), false);
  avatar_ok := coalesce(public.identity_allows(s.avatar_visibility, p_person, p_viewer), false);

  card := row(
    p.id,
    case when name_ok then p.display_name else coalesce(s.identity_alias, 'Без имени') end,
    case when name_ok then p.username end,
    case when avatar_ok then p.avatar_url end,
    case when name_ok then p.bio end,
    case when name_ok then p.status end,
    not name_ok,
    false
  );
  return card;
end;
$$;

/**
 * Люди глазами смотрящего вне диалогов: профиль, поиск, списки. Только по
 * id — каталога нет. Заблокировавший смотрящего не отдаётся, как и раньше
 * политикой `profiles`.
 */
create function public.profile_cards(ids uuid[])
returns table (
  id uuid,
  display_name text,
  username text,
  avatar_url text,
  bio text,
  status text,
  masked boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if coalesce(cardinality(ids), 0) > 200 then
    raise exception 'Слишком много людей за раз' using errcode = '22023';
  end if;

  return query
  select c.id, c.display_name, c.username, c.avatar_url, c.bio, c.status, c.masked
  from (select distinct x from unnest(coalesce(ids, '{}')) as x) wanted
  cross join lateral public.person_card(wanted.x, me, null) c
  where c.id is not null
    and wanted.x <> all ((select public.my_blockers())::uuid[]);
end;
$$;

-- =============================================================================
-- profiles: имя, username, фото, «О себе» и статус — только через функции
-- =============================================================================
--
-- Права на колонки: читается только то, что о человеке не говорит, кто он.
-- Свои колонки владелец по-прежнему пишет (права на UPDATE — по колонкам,
-- политика — своя строка), но читает их через `profile_cards`.

revoke select on public.profiles from anon, authenticated;
grant select (id, created_at, deleted_at) on public.profiles to authenticated;

-- =============================================================================
-- Права
-- =============================================================================

revoke execute on function public.identity_hmac(text) from public, anon, authenticated;
revoke execute on function public.alias_random() from public, anon, authenticated;
revoke execute on function public.alias_compose(bytea) from public, anon, authenticated;
revoke execute on function public.alias_male_names() from public, anon, authenticated;
revoke execute on function public.alias_female_names() from public, anon, authenticated;
revoke execute on function public.alias_surnames() from public, anon, authenticated;
revoke execute on function public.alias_feminine_surname(text) from public, anon, authenticated;
revoke execute on function public.fill_identity_alias() from public, anon, authenticated;
revoke execute on function public.chat_participant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.chat_opaque_id(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.chat_alias(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.person_card(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.dialogue_masked(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.identity_allows(text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.person_shown_id(uuid, uuid, uuid) from public, anon, authenticated;

revoke execute on function public.regenerate_identity_alias() from public, anon;
revoke execute on function public.profile_cards(uuid[]) from public, anon;
grant execute on function public.regenerate_identity_alias() to authenticated;
grant execute on function public.profile_cards(uuid[]) to authenticated;
