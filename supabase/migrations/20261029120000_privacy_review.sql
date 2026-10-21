-- Правки по ревью этапа 1 приватности.
--
--   1. Брошенный аккаунт — без даты больше суток И без активности сеанса за
--      сутки. Клиент при сбое загрузки настроек пускает во вкладки (не
--      запирает приложение), и аккаунт, которым реально пользуются, не должен
--      пропасть по расписанию только потому, что ворота не успели сработать.
--   2. Возраст и «дата в будущем» — с запасом в сутки: сервер считает в UTC, а
--      человек выбирает день по своему календарю. Без запаса в UTC+3 в час
--      ночи в свой 13-й день рождения он получил бы отказ «младше 13» и
--      предложение удалить аккаунт. Подростковые значения по умолчанию
--      по-прежнему считаются строго по UTC — в сторону защиты.
--   3. Лимит частоты заявок в друзья проверяется под блокировкой отправителя:
--      блокировка пары не мешала параллельным заявкам разным людям пройти
--      проверку все разом.

-- =============================================================================
-- 1. Брошенные аккаунты
-- =============================================================================

create or replace function public.delete_abandoned_accounts()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  delete from auth.users u
  using public.privacy_settings s
  where s.user_id = u.id
    and s.birth_date is null
    and s.created_at < now() - interval '24 hours'
    and not exists (
      select 1 from auth.sessions ss
      where ss.user_id = u.id
        and greatest(ss.created_at, ss.updated_at, ss.refreshed_at) > now() - interval '24 hours'
    );

  get diagnostics n = row_count;

  return n;
end;
$$;

revoke execute on function public.delete_abandoned_accounts() from public, anon, authenticated;

-- =============================================================================
-- 2. Дата рождения с запасом на часовые пояса
-- =============================================================================

/**
 * Самый поздний «сегодня» на Земле (UTC+14) — граница для отказов. Значения
 * по умолчанию считаются от current_date: кому сегодня 18 только по
 * календарю впереди UTC, тот получает подростковые — в сторону защиты.
 */
create function public.latest_local_date()
returns date
language sql
stable
as $$
  select (now() at time zone 'Etc/GMT-14')::date
$$;

create or replace function public.set_birth_date(p_birth_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  current_row public.privacy_settings;
  first_time boolean;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if p_birth_date is null then
    raise exception 'Укажите дату рождения' using errcode = '22023';
  end if;

  if p_birth_date > public.latest_local_date() then
    raise exception 'Дата рождения в будущем' using errcode = 'OPN03';
  end if;

  if extract(year from age(public.latest_local_date(), p_birth_date))::int < 13 then
    raise exception 'Регистрация в Open возможна с 13 лет' using errcode = 'OPN04';
  end if;

  select * into current_row from public.privacy_settings where user_id = me for update;

  if not found then
    insert into public.privacy_settings
    select * from public.privacy_settings_row(me, true);

    select * into current_row from public.privacy_settings where user_id = me for update;
  end if;

  first_time := current_row.initialized_at is null;

  if first_time then
    perform public.apply_privacy_defaults(me, public.age_in_years(p_birth_date) < 18);
  end if;

  update public.privacy_settings
  set birth_date = p_birth_date,
      initialized_at = coalesce(initialized_at, now()),
      updated_at = now()
  where user_id = me;

  return jsonb_build_object('birth_date', p_birth_date, 'initialized', first_time);
end;
$$;

revoke execute on function public.latest_local_date() from public, anon;
revoke execute on function public.set_birth_date(date) from public, anon;
grant execute on function public.latest_local_date() to authenticated;
grant execute on function public.set_birth_date(date) to authenticated;

-- =============================================================================
-- 3. Лимит заявок — под блокировкой отправителя
-- =============================================================================

create or replace function public.friend_request_limit_reached(p_user uuid)
returns boolean
language plpgsql
volatile
set search_path = public
as $$
begin
  -- Параллельные заявки одного человека разным людям встают в очередь здесь,
  -- и каждая видит записи предыдущих.
  perform pg_advisory_xact_lock(hashtextextended('friend_requests_of:' || p_user::text, 0));

  return
    (select count(*) from public.friend_request_log
      where requester_id = p_user and created_at > now() - interval '1 hour') >= 30
    or (select count(*) from public.friend_request_log
      where requester_id = p_user and created_at > now() - interval '1 day') >= 100;
end;
$$;

revoke execute on function public.friend_request_limit_reached(uuid) from public, anon, authenticated;
