-- Приватность, этап 2: «Кто видит, что я в сети» (`activity_status_visibility`).
--
-- Раньше «в сети» шло через общий Presence-канал `presence:online` (публичный —
-- его слушал любой с anon key), а «был(а) в …» — из открытой колонки
-- `profiles.last_seen_at`. Внутри одного Presence-канала по зрителю не
-- отфильтровать, а авторизация Realtime проверяется при входе в канал и не
-- отзывается при смене настройки. Поэтому онлайн теперь серверный:
--
--   user_presence    — приватная строка аккаунта: когда был в приложении и до
--                      какого момента считается «в сети». Пишет только
--                      `mark_seen` (клиент — раз в минуту, пока открыт, и при
--                      уходе в фон); читает только `activity_statuses`.
--   activity_statuses(ids) — статус каждого с проверкой `privacy_allows` для
--                      смотрящего. Закрытый, удалённый и ни разу не
--                      заходивший отдаются одинаково: не в сети, без времени.
--                      Смена настройки действует со следующего же запроса.
--
-- «Печатает» и «записывает голосовое» мой клиент шлёт сам — он и решает,
-- кому (`my_typing_audience`): всем — в топик чата, как раньше; только
-- друзьям — в топик участников `chat-members:<id>` и только если все
-- остальные участники мне друзья; никому — никуда. Топик участников читают и
-- пишут только участники чата (политики `realtime.messages`), в топик чата
-- писать теперь тоже может только участник.
--
-- Звонки остаются публичными по замыслу продукта: участие в звонке сигналом
-- активности не считается и здесь не скрывается.

-- =============================================================================
-- Отметка активности
-- =============================================================================

create table public.user_presence (
  id uuid primary key default gen_random_uuid(),
  -- Каскад: приватные данные аккаунта уходят вместе с ним.
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  -- До какого момента «в сети»; null — ушёл (приложение в фоне).
  online_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_presence enable row level security;
revoke all on public.user_presence from anon, authenticated;

insert into public.user_presence (user_id, last_seen_at)
select p.id, p.last_seen_at from public.profiles p where p.last_seen_at is not null
on conflict (user_id) do nothing;

alter table public.profiles drop column last_seen_at;

drop function public.mark_seen();

/**
 * Отметить себя: `online` — приложение на переднем плане, «в сети» ещё две
 * минуты (клиент подтверждает раз в минуту); иначе — ушёл, «был(а) сейчас».
 * Подтверждение «в сети» чаще раза в 20 с строку не трогает.
 */
create function public.mark_seen(online boolean default true)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.user_presence as u (user_id, last_seen_at, online_until)
  values (
    auth.uid(),
    now(),
    case when online then now() + interval '2 minutes' end
  )
  on conflict (user_id) do update
    set last_seen_at = now(),
        online_until = excluded.online_until,
        updated_at = now()
    where not online
      or u.online_until is null
      or u.last_seen_at < now() - interval '20 seconds'
$$;

revoke execute on function public.mark_seen(boolean) from public, anon;
grant execute on function public.mark_seen(boolean) to authenticated;

-- =============================================================================
-- Статус глазами смотрящего
-- =============================================================================

/**
 * Статус людей по id, не больше 200 за раз. Кому настройка не разрешает —
 * как у ни разу не заходившего: `online = false`, `last_seen_at = null`.
 */
create function public.activity_statuses(user_ids uuid[])
returns table (user_id uuid, online boolean, last_seen_at timestamptz)
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

  if coalesce(cardinality(user_ids), 0) > 200 then
    raise exception 'Слишком много людей за раз' using errcode = '22023';
  end if;

  return query
  select
    p.id,
    coalesce(allowed.yes and u.online_until > now(), false),
    case when allowed.yes then u.last_seen_at end
  from public.profiles p
  left join public.user_presence u on u.user_id = p.id
  cross join lateral (
    select public.privacy_allows('activity_status_visibility', p.id, me) as yes
  ) allowed
  where p.id = any (coalesce(user_ids, '{}'))
    and p.deleted_at is null;
end;
$$;

revoke execute on function public.activity_statuses(uuid[]) from public, anon;
grant execute on function public.activity_statuses(uuid[]) to authenticated;

-- =============================================================================
-- «Печатает»: кому слать
-- =============================================================================

/**
 * Куда мой клиент шлёт «печатает» в этот чат: `chat` — в топик чата (видно
 * всем), `members` — в топик участников, `none` — никуда. Не участник — `none`.
 */
create function public.my_typing_audience(target_chat uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  visibility text;
begin
  if me is null or not exists (
    select 1 from public.chat_members where chat_id = target_chat and user_id = me
  ) then
    return 'none';
  end if;

  select s.activity_status_visibility into visibility
  from public.privacy_settings s
  where s.user_id = me;

  if visibility = 'everyone' then
    return 'chat';
  end if;

  if visibility = 'friends' and not exists (
    select 1 from public.chat_members cm
    where cm.chat_id = target_chat
      and cm.user_id <> me
      and not public.are_friends(me, cm.user_id)
  ) then
    return 'members';
  end if;

  return 'none';
end;
$$;

revoke execute on function public.my_typing_audience(uuid) from public, anon;
grant execute on function public.my_typing_audience(uuid) to authenticated;

-- =============================================================================
-- Топики Realtime
-- =============================================================================

/** Смотрящий — участник чата из топика `<prefix><uuid>`. Неразборчивый топик — нет. */
create function public.realtime_topic_member(p_topic text, p_prefix text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  if p_topic is null or left(p_topic, char_length(p_prefix)) <> p_prefix then
    return false;
  end if;

  begin
    target := substr(p_topic, char_length(p_prefix) + 1)::uuid;
  exception
    when invalid_text_representation then
      return false;
  end;

  return exists (
    select 1 from public.chat_members where chat_id = target and user_id = auth.uid()
  );
end;
$$;

revoke execute on function public.realtime_topic_member(text, text) from public, anon;
grant execute on function public.realtime_topic_member(text, text) to authenticated;

-- В топик чата клиент шлёт только «печатает» — и только участник.
drop policy "typing can be broadcast to chat topics" on realtime.messages;

create policy "typing can be broadcast to chat topics by members"
  on realtime.messages for insert
  to authenticated
  with check (public.realtime_topic_member(realtime.topic(), 'chat:'));

create policy "chat member topics are readable by members"
  on realtime.messages for select
  to authenticated
  using (public.realtime_topic_member(realtime.topic(), 'chat-members:'));

create policy "chat member topics are writable by members"
  on realtime.messages for insert
  to authenticated
  with check (public.realtime_topic_member(realtime.topic(), 'chat-members:'));
