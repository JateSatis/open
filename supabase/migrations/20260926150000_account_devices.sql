-- Аккаунт и профиль: закрытая запись в profiles, статус, устройства и сеансы.
--
-- Три вещи:
--   1. Профиль больше нельзя «удалить» запросом в обход приложения. UPDATE-
--      политика пускала владельца менять любую колонку, включая `deleted_at`
--      и даже `id`. Теперь пишутся только колонки, которые человек вправе
--      менять; профиль исчезает только вместе с аккаунтом (Edge Function
--      `delete-account`).
--   2. Статус — короткая строка под именем.
--   3. Устройства: Supabase не отдаёт клиенту список сеансов, поэтому каждое
--      устройство регистрирует себя само и связывается с `session_id` из JWT.
--      Завершить сеанс можно только свой — функцией, которая сама проверяет
--      владельца.

-- =============================================================================
-- profiles: только разрешённые колонки
-- =============================================================================

alter table public.profiles
  add column status text,
  -- Граница против мусора, а не продуктовый лимит: тот живёт на клиенте
  -- (STATUS_MAX_LENGTH в src/features/profile/username.ts) и может меняться.
  add constraint profiles_status_length check (char_length(status) <= 200);

-- Прав на колонки достаточно: RLS по-прежнему решает, чью строку можно
-- менять (свою), а права — какие поля в ней. `deleted_at`, `id` и
-- `created_at` в списке нет, так что запрос в обход приложения их не тронет.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (username, display_name, avatar_url, bio, status) on public.profiles to authenticated;

-- =============================================================================
-- devices
-- =============================================================================
--
-- Устройство, на котором выполнен вход. Одна строка на пару «аккаунт +
-- установка приложения»: повторный вход на том же телефоне переиспользует
-- строку, а не плодит новые.
--
-- Таблица приватная — исключение из правила «SELECT открыт всем»: модель
-- телефона и время последней активности о человеке публичными не являются.
-- Читает её только владелец, пишут только функции ниже.
--
-- Сюда же потом лягут push-токены: токен принадлежит установке приложения, а
-- не аккаунту, и умирает вместе с сеансом.

create table public.devices (
  id uuid primary key default gen_random_uuid (),
  -- Каскад, а не set null: приватные данные уходят вместе с аккаунтом, в
  -- публичной истории на них ничего не ссылается.
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Случайный id установки из хранилища приложения: живёт, пока приложение
  -- не переустановили.
  installation_id uuid not null,
  -- Сеанс Supabase, под которым устройство сейчас вошло. Обнуляется сам,
  -- когда сеанс удаляют — выходом, завершением с другого устройства или
  -- удалением аккаунта.
  session_id uuid references auth.sessions (id) on delete set null,
  platform text not null check (platform in ('ios', 'android', 'web')),
  model text check (char_length(model) <= 100),
  os_version text check (char_length(os_version) <= 50),
  app_version text check (char_length(app_version) <= 50),
  push_token text,
  push_token_updated_at timestamptz,
  last_seen_at timestamptz not null default now(),
  -- Мягкий конец сеанса на этом устройстве: строка остаётся, чтобы
  -- повторный вход на том же телефоне её переиспользовал.
  signed_out_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, installation_id)
);

-- Один сеанс — одно устройство.
create unique index devices_session_id_key on public.devices (session_id) where session_id is not null;
create unique index devices_push_token_key on public.devices (push_token) where push_token is not null;

alter table public.devices enable row level security;

create policy "devices are readable by their owner"
  on public.devices for select
  to authenticated
  using (auth.uid() = user_id);

-- Политик на запись нет намеренно: `session_id` должен браться из JWT, а не
-- из запроса клиента, поэтому устройство меняют только функции ниже.
revoke insert, update, delete on public.devices from anon, authenticated;
revoke select on public.devices from anon;

-- Сеанс, под которым пришёл запрос. Токен выдаёт Auth, подделать его клиент
-- не может.
create function public.current_session_id()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'session_id', '')::uuid
$$;

revoke execute on function public.current_session_id() from public, anon;
grant execute on function public.current_session_id() to authenticated;

-- =============================================================================
-- Регистрация устройства
-- =============================================================================

create function public.register_device(
  p_installation_id uuid,
  p_platform text,
  p_model text,
  p_os_version text,
  p_app_version text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  sid uuid := public.current_session_id();
  previous_session uuid;
  device_id uuid;
begin
  if me is null or sid is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if not exists (select 1 from auth.sessions where id = sid and user_id = me) then
    raise exception 'Сеанс завершён' using errcode = '28000';
  end if;

  select session_id into previous_session
  from public.devices
  where user_id = me and installation_id = p_installation_id;

  -- Сеанс сменился на том же устройстве (например, после привязки второго
  -- способа входа Auth выдаёт новый). Прежний больше никому не принадлежит:
  -- токен от него приложение уже выбросило, и висеть «призраком» в списке
  -- он не должен.
  if previous_session is not null and previous_session <> sid then
    delete from auth.sessions where id = previous_session and user_id = me;
  end if;

  -- Этот сеанс мог числиться за другой установкой того же человека — такое
  -- бывает, только если id установки потерялся. Сеанс переезжает сюда.
  update public.devices
  set session_id = null
  where session_id = sid and not (user_id = me and installation_id = p_installation_id);

  insert into public.devices as d (
    user_id, installation_id, session_id, platform, model, os_version, app_version, last_seen_at
  )
  values (me, p_installation_id, sid, p_platform, p_model, p_os_version, p_app_version, now())
  on conflict (user_id, installation_id) do update
  set session_id = excluded.session_id,
      platform = excluded.platform,
      model = excluded.model,
      os_version = excluded.os_version,
      app_version = excluded.app_version,
      last_seen_at = now(),
      signed_out_at = null
  returning d.id into device_id;

  return device_id;
end;
$$;

revoke execute on function public.register_device(uuid, text, text, text, text) from public, anon;
grant execute on function public.register_device(uuid, text, text, text, text) to authenticated;

-- =============================================================================
-- Отметка активности и проверка, что сеанс ещё жив
-- =============================================================================
--
-- Выданный access-токен остаётся валидным до истечения, даже когда сеанс уже
-- завершили с другого устройства: Auth отзывает только refresh. Приложение
-- зовёт эту функцию при каждом возврате на передний план и, получив false,
-- тихо выходит — для человека это просто выход.

create function public.touch_device(p_installation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  sid uuid := public.current_session_id();
begin
  if me is null or sid is null then
    return false;
  end if;

  if not exists (select 1 from auth.sessions where id = sid and user_id = me) then
    return false;
  end if;

  -- Не чаще раза в пять минут: отметка нужна для списка устройств, а не
  -- для точного «в сети» — то живёт в Presence.
  update public.devices
  set last_seen_at = now()
  where user_id = me
    and installation_id = p_installation_id
    and session_id = sid
    and last_seen_at < now() - interval '5 minutes';

  return true;
end;
$$;

revoke execute on function public.touch_device(uuid) from public, anon;
grant execute on function public.touch_device(uuid) to authenticated;

-- =============================================================================
-- Завершение сеансов
-- =============================================================================

-- Завершает сеанс одного своего устройства. Чужое устройство или чужой
-- сеанс функция просто не находит: ни ошибки, ни действия.
create function public.end_device_session(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  target_session uuid;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  update public.devices
  set signed_out_at = now()
  where id = p_device_id and user_id = me
  returning session_id into target_session;

  if target_session is not null then
    -- user_id проверяется и здесь: даже если строка устройства каким-то
    -- образом ссылалась бы на чужой сеанс, он не удалится.
    delete from auth.sessions where id = target_session and user_id = me;
  end if;
end;
$$;

revoke execute on function public.end_device_session(uuid) from public, anon;
grant execute on function public.end_device_session(uuid) to authenticated;

-- Завершает все свои сеансы, кроме того, из которого пришёл запрос, —
-- включая те, что не привязаны ни к одному устройству (вход со старой версии
-- приложения до появления списка устройств).
create function public.end_other_sessions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  sid uuid := public.current_session_id();
begin
  if me is null or sid is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  update public.devices
  set signed_out_at = now()
  where user_id = me and session_id is distinct from sid and signed_out_at is null;

  delete from auth.sessions where user_id = me and id <> sid;
end;
$$;

revoke execute on function public.end_other_sessions() from public, anon;
grant execute on function public.end_other_sessions() to authenticated;

-- Отметка выхода на этом устройстве. Сам сеанс удаляет Auth при signOut;
-- функция нужна, чтобы строка сразу перестала числиться активной.
create function public.mark_device_signed_out(p_installation_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.devices
  set signed_out_at = now()
  where user_id = auth.uid() and installation_id = p_installation_id;
$$;

revoke execute on function public.mark_device_signed_out(uuid) from public, anon;
grant execute on function public.mark_device_signed_out(uuid) to authenticated;
