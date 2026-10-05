-- Просмотры сообщений и «прочитано» по сообщению.
--
-- Сообщение засчитывает просмотр, как только хоть краем показалось на экране
-- у человека. Два числа, оба денормализованы в строке сообщения, как
-- `comments_count`:
--   unique_views_count — сколько разных людей видели (один человек — один раз
--                        навсегда);
--   views_count        — сколько раз показывалось: одно открытие экрана чата
--                        одним человеком — не больше +1, сколько бы раз
--                        сообщение ни уезжало за край и ни возвращалось.
-- Автор себе просмотров не накручивает.
--
-- «Прочитано» теперь у каждого сообщения своё: `read_at` — когда его впервые
-- увидел участник чата, не автор. Посетитель двигает только счётчики.
-- `chat_members.last_read_at` и `mark_chat_read` остаются — на них держится
-- точка «непрочитано» в списке чатов.

alter table public.messages
  add column views_count int not null default 0,
  add column unique_views_count int not null default 0,
  add column read_at timestamptz;

-- =============================================================================
-- Кто что видел
-- =============================================================================
--
-- Строка на пару (сообщение, зритель): по ней уникальный просмотр
-- засчитывается один раз, а неуникальный — раз на сессию экрана.
--
-- Сессию называет клиент, и сервер ей не верит: сменой `session_id` на каждом
-- вызове можно было бы крутить счётчик бесконечно. Поэтому неуникальный +1
-- засчитывается, только если с прошлого засчитанного для этой пары прошло не
-- меньше 10 секунд. Честному человеку этого не заметить — выйти из чата и
-- зайти снова быстрее почти невозможно, — а накрутка одним аккаунтом
-- упирается в 6 просмотров в минуту на сообщение.
--
-- Что человек смотрел — его личная история, не публичный контент: политик
-- нет, пользователям таблица закрыта целиком, пишет только функция ниже.
-- Приватные данные аккаунта уходят вместе с ним (`on delete cascade`), а
-- посчитанное остаётся в счётчиках сообщения.

create table public.message_views (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  message_id uuid not null references public.messages (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  -- Сессия экрана, в которой засчитан последний неуникальный просмотр.
  session_id uuid not null,
  counted_at timestamptz not null default now(),
  constraint message_views_message_viewer_key unique (message_id, viewer_id)
);

create index message_views_viewer_id_idx on public.message_views (viewer_id);

alter table public.message_views enable row level security;

revoke all on public.message_views from anon, authenticated;

-- Новое сообщение — без просмотров и непрочитанное: готовые числа с клиента
-- не принимаются. Та же политика, что в 20261005100000_messages_insert_whitelist.sql,
-- плюс новые колонки.
drop policy "messages can only be sent by chat members" on public.messages;

create policy "messages can only be sent by chat members"
  on public.messages for insert
  to authenticated
  with check (
    auth.uid() = author_id
    and auth.uid() in (
      select user_id from public.chat_members where chat_id = messages.chat_id
    )
    and kind in ('text', 'media', 'voice')
    and forwarded_comment_id is null
    and source_chat_id is null
    and stream_id is null
    and system_event is null
    and deleted_at is null
    and comments_count = 0
    and reactions_count = 0
    and member_reactions = '{}'::jsonb
    and visitor_reactions = '{}'::jsonb
    and views_count = 0
    and unique_views_count = 0
    and read_at is null
  );

-- =============================================================================
-- Запись просмотров
-- =============================================================================
--
-- Пачкой: всё, что показалось на экране чата за пару секунд. Засчитывается
-- только живое сообщение этого чата, не островок пересылки (он не сообщение)
-- и не своё. Оригинал в островке другого чата клиент засчитывает вызовом на
-- чат оригинала. Участник чата (не автор) ставит сообщению `read_at`, если
-- его ещё нет.
--
-- После записи — одно событие в топик чата со списком затронутых сообщений.
-- Payload, как и у остальных событий топика, только сигнал: писать в топик
-- может любой, поэтому числа клиент перечитывает из базы.

create function public.record_message_views(
  target_chat uuid,
  message_ids uuid[],
  session_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  viewer uuid := auth.uid();
  valid uuid[];
  counted uuid[];
  read uuid[] := '{}';
  touched uuid[];
begin
  if viewer is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if session_id is null then
    raise exception 'session is required' using errcode = '22004';
  end if;

  if coalesce(cardinality(message_ids), 0) = 0 then
    return;
  end if;

  -- Больше на одном экране за пару секунд не покажется.
  if cardinality(message_ids) > 200 then
    raise exception 'too many messages' using errcode = '22023';
  end if;

  select coalesce(array_agg(m.id), '{}')
  into valid
  from public.messages m
  where m.id = any (message_ids)
    and m.chat_id = target_chat
    and m.deleted_at is null
    and m.kind <> 'forward'
    and m.author_id is distinct from viewer;

  if cardinality(valid) = 0 then
    return;
  end if;

  -- Первая строка пары — уникальный и неуникальный просмотр. Следующие —
  -- только неуникальный, если это другая сессия и прошло достаточно времени.
  with upserted as (
    insert into public.message_views as v (message_id, viewer_id, session_id, counted_at)
    select id, viewer, record_message_views.session_id, now()
    from unnest(valid) as id
    on conflict (message_id, viewer_id) do update
      set session_id = excluded.session_id,
          counted_at = excluded.counted_at
      where v.session_id <> excluded.session_id
        and v.counted_at <= now() - interval '10 seconds'
    -- xmax = 0 — строку вставили, а не обновили: первый просмотр человеком.
    returning v.message_id, (v.xmax = 0) as first_view
  ),
  bumped as (
    update public.messages m
    set views_count = m.views_count + 1,
        unique_views_count = m.unique_views_count + case when u.first_view then 1 else 0 end
    from upserted u
    where m.id = u.message_id
    returning m.id
  )
  select coalesce(array_agg(id), '{}') into counted from bumped;

  if exists (
    select 1 from public.chat_members
    where chat_id = target_chat and user_id = viewer
  ) then
    with marked as (
      update public.messages
      set read_at = now()
      where id = any (valid) and read_at is null
      returning id
    )
    select coalesce(array_agg(id), '{}') into read from marked;
  end if;

  select coalesce(array_agg(distinct id), '{}')
  into touched
  from unnest(counted || read) as id;

  if cardinality(touched) = 0 then
    return;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object('chat_id', target_chat, 'message_ids', to_jsonb(touched)),
      'views_changed',
      'chat:' || target_chat::text,
      true
    );
  exception
    when others then null;
  end;
end;
$$;

revoke execute on function public.record_message_views(uuid, uuid[], uuid) from public, anon;
grant execute on function public.record_message_views(uuid, uuid[], uuid) to authenticated;

-- =============================================================================
-- Перенос старого «прочитано»
-- =============================================================================
--
-- До этой миграции прочтение было одной отметкой участника на весь чат.
-- Сообщение считается прочитанным, если кто-то из других участников отметил
-- чат прочитанным после его отправки; `read_at` — самая ранняя такая
-- отметка: точнее момент первого прочтения уже не узнать. Счётчики старых
-- сообщений начинаются с нуля.
--
-- Триггеры на UPDATE сообщений (удаление, правка, пересчёт цитат) смотрят на
-- свои колонки и на `read_at` не отзываются.

update public.messages m
set read_at = first_read.read_at
from (
  select msg.id, min(cm.last_read_at) as read_at
  from public.messages msg
  join public.chat_members cm
    on cm.chat_id = msg.chat_id
   and cm.user_id is distinct from msg.author_id
   and cm.last_read_at >= msg.created_at
  where msg.kind <> 'forward'
  group by msg.id
) first_read
where m.id = first_read.id;
