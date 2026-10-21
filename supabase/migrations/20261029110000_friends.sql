-- Друзья: взаимная связь, подтверждённая обеими сторонами.
--
-- Одна строка `friendships` на пару людей: кто позвал, кого, статус. Друзья —
-- только `accepted`; одностороння заявка не даёт ничего ни в одной проверке
-- (`are_friends`). Это не подписка: в ленте и счётчиках подписчиков друзья не
-- участвуют.
--
-- Отказ отправителю не раскрывается (как `chat_waiting_invitees`): для него
-- отклонённая заявка — та же «Заявка отправлена». Повторное «Добавить» после
-- отказа новой строки не создаёт и получателя не тревожит.
--
-- Таблица закрыта целиком: статус пары читают и меняют только функции ниже,
-- иначе отправитель увидел бы `declined` прямым запросом.

create table public.friendships (
  id uuid primary key default gen_random_uuid (),
  -- Каскад: дружба — связь аккаунта, а не публичная история; уходит вместе с
  -- любым из двоих.
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  -- Отправитель отменил заявку, которую ему уже отклонили. Строка остаётся,
  -- чтобы повторная заявка снова не пришла получателю; для отправителя пары
  -- больше нет.
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  accepted_at timestamptz,
  constraint friendships_not_self check (requester_id <> addressee_id),
  constraint friendships_status_timestamps check (
    (status = 'pending' and accepted_at is null and withdrawn_at is null)
    or (status = 'accepted' and accepted_at is not null and withdrawn_at is null)
    or (status = 'declined' and responded_at is not null and accepted_at is null)
  )
);

-- Одна строка на пару, кто бы кого ни звал.
create unique index friendships_pair_key
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create index friendships_addressee_pending_idx
  on public.friendships (addressee_id, created_at desc)
  where status = 'pending';

-- Список друзей человека — с любой стороны пары.
create index friendships_requester_accepted_idx
  on public.friendships (requester_id, accepted_at desc)
  where status = 'accepted';
create index friendships_addressee_accepted_idx
  on public.friendships (addressee_id, accepted_at desc)
  where status = 'accepted';

alter table public.friendships enable row level security;

-- Политик нет намеренно: читают и пишут только функции.
revoke all on public.friendships from anon, authenticated;

create function public.guard_friendship_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.requester_id <> old.requester_id or new.addressee_id <> old.addressee_id
    or new.created_at <> old.created_at then
    raise exception 'Заявку в друзья нельзя переадресовать';
  end if;

  if new.status <> old.status and not (
    (old.status = 'pending' and new.status in ('accepted', 'declined'))
    or (old.status = 'declined' and new.status = 'accepted')
  ) then
    raise exception 'Недопустимый переход заявки в друзья: % → %', old.status, new.status;
  end if;

  return new;
end;
$$;

create trigger friendships_guard_update
  before update on public.friendships
  for each row execute function public.guard_friendship_update();

-- =============================================================================
-- Журнал отправленных заявок — для лимита частоты
-- =============================================================================
--
-- Отмена неотвеченной заявки удаляет строку пары, поэтому считать частоту по
-- `friendships` нельзя: отменил-отправил по кругу — и лимита нет. Закрыта,
-- чистится вместе с брошенными аккаунтами.

create table public.friend_request_log (
  id uuid primary key default gen_random_uuid (),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index friend_request_log_requester_idx on public.friend_request_log (requester_id, created_at desc);

alter table public.friend_request_log enable row level security;
revoke all on public.friend_request_log from anon, authenticated;

-- Защита от спама, а не продуктовый лимит.
create function public.friend_request_limit_reached(p_user uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    (select count(*) from public.friend_request_log
      where requester_id = p_user and created_at > now() - interval '1 hour') >= 30
    or (select count(*) from public.friend_request_log
      where requester_id = p_user and created_at > now() - interval '1 day') >= 100
$$;

-- =============================================================================
-- Друзья ли двое — единственная проверка
-- =============================================================================

create function public.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_a is not null and p_b is not null and p_a <> p_b and exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and least(f.requester_id, f.addressee_id) = least(p_a, p_b)
      and greatest(f.requester_id, f.addressee_id) = greatest(p_a, p_b)
  )
$$;

/** Строка пары или null. */
create function public.friendship_of(p_a uuid, p_b uuid)
returns public.friendships
language sql
stable
set search_path = public
as $$
  select * from public.friendships f
  where least(f.requester_id, f.addressee_id) = least(p_a, p_b)
    and greatest(f.requester_id, f.addressee_id) = greatest(p_a, p_b)
$$;

/**
 * Пара глазами `p_viewer`: none | outgoing | incoming | friends.
 * Отклонённую мою заявку я вижу как outgoing (отказ не раскрывается), а
 * отозванную — как none. Отклонённую мной заявку — как none: «Добавить» её
 * примет.
 */
create function public.friendship_status_for(p_viewer uuid, p_other uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f public.friendships;
begin
  f := public.friendship_of(p_viewer, p_other);

  if f.id is null then
    return 'none';
  end if;

  if f.status = 'accepted' then
    return 'friends';
  end if;

  if f.requester_id = p_viewer then
    return case when f.withdrawn_at is null then 'outgoing' else 'none' end;
  end if;

  return case when f.status = 'pending' then 'incoming' else 'none' end;
end;
$$;

-- =============================================================================
-- Действия — только от своего имени
-- =============================================================================

create function public.require_friend_target(p_other uuid)
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if p_other is null or p_other = me then
    raise exception 'Нельзя добавить в друзья самого себя' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles where id = p_other and deleted_at is null) then
    raise exception 'Пользователь не найден' using errcode = '22023';
  end if;

  return me;
end;
$$;

/** Блокировка пары: встречные нажатия идут по очереди и сходятся в дружбу. */
create function public.lock_friend_pair(p_a uuid, p_b uuid)
returns void
language sql
as $$
  select pg_advisory_xact_lock(
    hashtextextended('friend_pair:' || least(p_a, p_b)::text || ',' || greatest(p_a, p_b)::text, 0)
  )
$$;

/**
 * «Добавить в друзья». Встречная заявка (он уже звал меня, в том числе если я
 * отказал) — принятие. Возвращает новое состояние пары глазами вызывающего.
 * Лимит частоты — OPN05.
 */
create function public.send_friend_request(p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_friend_target(p_user);
  f public.friendships;
begin
  -- Сюда встанет проверка блокировок (этап 3).
  perform public.lock_friend_pair(me, p_user);

  f := public.friendship_of(me, p_user);

  if f.id is not null then
    if f.status = 'accepted' then
      return 'friends';
    end if;

    -- Он звал меня, я отказал, а он потом отозвал заявку: его согласия больше
    -- нет, и моё «Добавить» — новая заявка уже от меня.
    if f.addressee_id = me and f.withdrawn_at is not null then
      if public.friend_request_limit_reached(me) then
        raise exception 'Слишком много заявок в друзья, попробуйте позже' using errcode = 'OPN05';
      end if;

      delete from public.friendships where id = f.id;
      insert into public.friendships (requester_id, addressee_id) values (me, p_user);
      insert into public.friend_request_log (requester_id) values (me);

      return 'outgoing';
    end if;

    if f.addressee_id = me then
      update public.friendships
      set status = 'accepted', accepted_at = now(), responded_at = coalesce(responded_at, now()),
          withdrawn_at = null
      where id = f.id;

      return 'friends';
    end if;

    -- Моя заявка: неотвеченная — ничего не меняется; отклонённая и
    -- отозванная — снова «отправлена» для меня, получатель её не видит.
    if f.withdrawn_at is not null then
      update public.friendships set withdrawn_at = null where id = f.id;
    end if;

    return 'outgoing';
  end if;

  if public.friend_request_limit_reached(me) then
    raise exception 'Слишком много заявок в друзья, попробуйте позже' using errcode = 'OPN05';
  end if;

  insert into public.friendships (requester_id, addressee_id) values (me, p_user);
  insert into public.friend_request_log (requester_id) values (me);

  return 'outgoing';
end;
$$;

/** Отмена своей заявки. Неотвеченная исчезает, отклонённая — только для меня. */
create function public.cancel_friend_request(p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_friend_target(p_user);
  f public.friendships;
begin
  perform public.lock_friend_pair(me, p_user);

  f := public.friendship_of(me, p_user);

  if f.id is null or f.requester_id <> me or f.status = 'accepted' then
    return public.friendship_status_for(me, p_user);
  end if;

  if f.status = 'pending' then
    delete from public.friendships where id = f.id;
  else
    update public.friendships set withdrawn_at = now() where id = f.id;
  end if;

  return 'none';
end;
$$;

/** Принять заявку ко мне. Нечего принимать — состояние пары как есть. */
create function public.accept_friend_request(p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_friend_target(p_user);
begin
  perform public.lock_friend_pair(me, p_user);

  update public.friendships
  set status = 'accepted', accepted_at = now(), responded_at = coalesce(responded_at, now()),
      withdrawn_at = null
  where requester_id = p_user and addressee_id = me and status in ('pending', 'declined')
    and withdrawn_at is null;

  return public.friendship_status_for(me, p_user);
end;
$$;

/** Отклонить заявку ко мне. Отправитель об этом не узнаёт. */
create function public.decline_friend_request(p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_friend_target(p_user);
begin
  perform public.lock_friend_pair(me, p_user);

  update public.friendships
  set status = 'declined', responded_at = now()
  where requester_id = p_user and addressee_id = me and status = 'pending';

  return public.friendship_status_for(me, p_user);
end;
$$;

/** Удалить из друзей — любой из двоих, для обоих, без уведомления. */
create function public.remove_friend(p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := public.require_friend_target(p_user);
begin
  perform public.lock_friend_pair(me, p_user);

  delete from public.friendships f
  where f.status = 'accepted'
    and least(f.requester_id, f.addressee_id) = least(me, p_user)
    and greatest(f.requester_id, f.addressee_id) = greatest(me, p_user);

  return 'none';
end;
$$;

-- =============================================================================
-- Чтение
-- =============================================================================

/** Пара глазами вызывающего — для кнопки в чужом профиле. */
create function public.friendship_status(p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if p_user = me then
    return 'self';
  end if;

  return public.friendship_status_for(me, p_user);
end;
$$;

/**
 * Строка «Друзья» в профиле: можно ли мне видеть список (настройка владельца
 * через `privacy_allows`), сколько в нём друзей (только если можно) и —
 * в своём профиле — сколько входящих заявок.
 */
create function public.friends_summary(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  visible boolean;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  visible := public.privacy_allows('friends_list_visibility', p_user, me);

  return jsonb_build_object(
    'list_visible', visible,
    'friends_count', case when visible then (
      select count(*) from public.friendships f
      join public.profiles p
        on p.id = case when f.requester_id = p_user then f.addressee_id else f.requester_id end
       and p.deleted_at is null
      where f.status = 'accepted' and (f.requester_id = p_user or f.addressee_id = p_user)
    ) end,
    'incoming_count', case when p_user = me then (
      select count(*) from public.friendships f
      join public.profiles p on p.id = f.requester_id and p.deleted_at is null
      where f.addressee_id = me and f.status = 'pending'
    ) end
  );
end;
$$;

/**
 * Друзья человека, новые дружбы первыми, страницами. Список закрыт его
 * настройкой — 42501, а не пустой ответ, чтобы «закрыт» и «друзей нет» не
 * путались.
 */
create function public.list_friends(
  p_user uuid,
  p_limit int default 30,
  p_before_accepted_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  friendship_id uuid,
  accepted_at timestamptz,
  user_id uuid,
  display_name text,
  username text,
  avatar_url text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if not public.privacy_allows('friends_list_visibility', p_user, me) then
    raise exception 'Список друзей скрыт' using errcode = '42501';
  end if;

  return query
  select f.id, f.accepted_at, p.id, p.display_name, p.username, p.avatar_url
  from public.friendships f
  join public.profiles p
    on p.id = case when f.requester_id = p_user then f.addressee_id else f.requester_id end
   and p.deleted_at is null
  where f.status = 'accepted'
    and (f.requester_id = p_user or f.addressee_id = p_user)
    and (
      p_before_accepted_at is null
      or (f.accepted_at, f.id) < (p_before_accepted_at, p_before_id)
    )
  order by f.accepted_at desc, f.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

/** Входящие заявки ко мне, новые первыми, страницами. Отклонённые не показываются. */
create function public.list_incoming_friend_requests(
  p_limit int default 30,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  friendship_id uuid,
  created_at timestamptz,
  user_id uuid,
  display_name text,
  username text,
  avatar_url text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  return query
  select f.id, f.created_at, p.id, p.display_name, p.username, p.avatar_url
  from public.friendships f
  join public.profiles p on p.id = f.requester_id and p.deleted_at is null
  where f.addressee_id = me
    and f.status = 'pending'
    and (
      p_before_created_at is null
      or (f.created_at, f.id) < (p_before_created_at, p_before_id)
    )
  order by f.created_at desc, f.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

-- =============================================================================
-- Чистка журнала заявок
-- =============================================================================

create function public.purge_friend_request_log()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  delete from public.friend_request_log where created_at < now() - interval '2 days';
  get diagnostics n = row_count;

  return n;
end;
$$;

select cron.schedule(
  'purge-friend-request-log',
  '43 3 * * *',
  $$select public.purge_friend_request_log()$$
);

-- =============================================================================
-- Права
-- =============================================================================

revoke execute on function public.guard_friendship_update() from public, anon, authenticated;
revoke execute on function public.friend_request_limit_reached(uuid) from public, anon, authenticated;
revoke execute on function public.are_friends(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.friendship_of(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.friendship_status_for(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.require_friend_target(uuid) from public, anon, authenticated;
revoke execute on function public.lock_friend_pair(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.purge_friend_request_log() from public, anon, authenticated;

revoke execute on function public.send_friend_request(uuid) from public, anon;
revoke execute on function public.cancel_friend_request(uuid) from public, anon;
revoke execute on function public.accept_friend_request(uuid) from public, anon;
revoke execute on function public.decline_friend_request(uuid) from public, anon;
revoke execute on function public.remove_friend(uuid) from public, anon;
revoke execute on function public.friendship_status(uuid) from public, anon;
revoke execute on function public.friends_summary(uuid) from public, anon;
revoke execute on function public.list_friends(uuid, int, timestamptz, uuid) from public, anon;
revoke execute on function public.list_incoming_friend_requests(int, timestamptz, uuid) from public, anon;

grant execute on function public.send_friend_request(uuid) to authenticated;
grant execute on function public.cancel_friend_request(uuid) to authenticated;
grant execute on function public.accept_friend_request(uuid) to authenticated;
grant execute on function public.decline_friend_request(uuid) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.friendship_status(uuid) to authenticated;
grant execute on function public.friends_summary(uuid) to authenticated;
grant execute on function public.list_friends(uuid, int, timestamptz, uuid) to authenticated;
grant execute on function public.list_incoming_friend_requests(int, timestamptz, uuid) to authenticated;
