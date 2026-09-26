-- Заявки в чат.
--
-- До этой миграции участником чата можно было стать прямым INSERT в
-- `chat_members`: политика пускала строку с `auth.uid() = user_id`, то есть
-- любой добавлял себя в любой чат и писал в него в обход центральной
-- политики на `messages`, а любой участник добавлял кого угодно без спроса.
--
-- Теперь участником становятся ровно двумя путями, и оба — функции в базе:
-- создатель чата (`create_chat`) и принявший заявку (`accept_chat_invite`).
-- С клиента в `chat_members`, `chats` и `chat_invites` напрямую не пишет
-- никто, кроме отметки прочтения.

-- =============================================================================
-- Исходный набор людей чата
-- =============================================================================
--
-- Правило «нельзя создать второй чат с тем же набором, пока в первом не все
-- приняли» относится к набору в момент создания: состав потом меняется, а
-- правило — нет. Массив хранится отсортированным, чтобы сравнение наборов было
-- обычным равенством и шло по индексу.

alter table public.chats add column founding_member_ids uuid[];

-- Существующие чаты: их участники и есть исходный набор. Заявок у них нет,
-- значит все «приняли», и новому чату с теми же людьми они не мешают.
update public.chats c
set founding_member_ids = coalesce(
  (select array_agg(m.user_id order by m.user_id) from public.chat_members m where m.chat_id = c.id),
  '{}'
);

alter table public.chats
  alter column founding_member_ids set not null,
  alter column founding_member_ids set default '{}';

create index chats_founding_member_ids_idx
  on public.chats (founding_member_ids)
  where deleted_at is null;

-- =============================================================================
-- Запись в chats и chat_members только через функции
-- =============================================================================

drop policy "chats are created by their author" on public.chats;
revoke insert on public.chats from anon, authenticated;

-- Создатель может переименовать чат — и только. Без ограничения по колонкам
-- он переписал бы `created_by` или исходный набор и обошёл правило
-- уникальности.
revoke update on public.chats from anon, authenticated;
grant update (title) on public.chats to authenticated;

drop policy "chat_members can be added by themselves or existing members" on public.chat_members;
revoke insert on public.chat_members from anon, authenticated;

-- Своя строка участника меняется только в отметке прочтения. Иначе UPDATE
-- `chat_id` в своей строке переносил бы человека в любой чат — та же дыра,
-- что и прямой INSERT, только через другую дверь.
revoke update on public.chat_members from anon, authenticated;
grant update (last_read_at) on public.chat_members to authenticated;

-- Та же дверь у сообщений: автор мог сменить `chat_id` своего сообщения и
-- положить его в чат, где он не участник.
revoke update on public.messages from anon, authenticated;
grant update (text, edited_at, deleted_at) on public.messages to authenticated;

-- =============================================================================
-- chat_invites
-- =============================================================================
--
-- Внешние ключи на профили — `on delete set null` по общему правилу: удаление
-- аккаунта не должно стирать историю того, кто кого и когда позвал. Заявка без
-- приглашённого ничего не блокирует: позвать удалённый профиль всё равно
-- нельзя, а принять её больше некому.

create table public.chat_invites (
  id uuid primary key default gen_random_uuid (),
  chat_id uuid not null references public.chats (id) on delete cascade,
  inviter_id uuid references public.profiles (id) on delete set null,
  invitee_id uuid references public.profiles (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  declined_at timestamptz,
  unique (chat_id, invitee_id),
  -- Принятая после отказа заявка хранит обе метки: и когда отказал, и когда
  -- передумал.
  constraint chat_invites_status_timestamps check (
    (status = 'pending' and accepted_at is null and declined_at is null)
    or (status = 'accepted' and accepted_at is not null)
    or (status = 'declined' and declined_at is not null and accepted_at is null)
  )
);

create index chat_invites_invitee_id_status_idx on public.chat_invites (invitee_id, status);

alter table public.chat_invites enable row level security;

-- Статус заявки целиком видит только сам приглашённый. Создателю и
-- посетителям отказ не показывается — ни в интерфейсе, ни прямым запросом:
-- для них есть только `chat_waiting_invitees` ниже.
create policy "chat_invites are readable by their invitee"
  on public.chat_invites for select
  to authenticated
  using (auth.uid() = invitee_id);

-- Политик на запись нет намеренно: заявки создаёт и меняет только функция.
revoke insert, update, delete on public.chat_invites from anon, authenticated;

-- Допустимые переходы статуса проверяет база: функция ответа на заявку — не
-- единственный код, который когда-нибудь будет её менять.
create function public.guard_chat_invite_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.chat_id <> old.chat_id or new.created_at <> old.created_at then
    raise exception 'Заявку нельзя перенести в другой чат';
  end if;

  -- Единственная допустимая смена людей — обнуление при удалении аккаунта.
  if (new.invitee_id is distinct from old.invitee_id and new.invitee_id is not null)
    or (new.inviter_id is distinct from old.inviter_id and new.inviter_id is not null) then
    raise exception 'Заявку нельзя переадресовать';
  end if;

  if new.status <> old.status and not (
    (old.status = 'pending' and new.status in ('accepted', 'declined'))
    or (old.status = 'declined' and new.status = 'accepted')
  ) then
    raise exception 'Недопустимый переход заявки: % → %', old.status, new.status;
  end if;

  return new;
end;
$$;

create trigger chat_invites_guard_update
  before update on public.chat_invites
  for each row execute function public.guard_chat_invite_update();

-- =============================================================================
-- Кто ещё не принял заявку — публично, без статуса
-- =============================================================================
--
-- Отклонённая заявка здесь выглядит так же, как неотвеченная: «ещё не
-- принял». Это защищает отказавшего от давления (так делают Instagram и
-- Messenger). View принадлежит владельцу схемы и обходит RLS на
-- `chat_invites` намеренно: наружу выходят только колонки ниже, по которым
-- отказ не отличить от молчания.

create view public.chat_waiting_invitees
with (security_invoker = false)
as
select
  i.chat_id,
  i.invitee_id as user_id,
  i.created_at as invited_at,
  p.display_name,
  p.avatar_url
from public.chat_invites i
join public.profiles p on p.id = i.invitee_id and p.deleted_at is null
where i.status <> 'accepted';

revoke all on public.chat_waiting_invitees from anon, authenticated;
grant select on public.chat_waiting_invitees to authenticated;

-- =============================================================================
-- Создание чата
-- =============================================================================
--
-- Один выбранный человек — личный диалог, несколько — группа. Создатель сразу
-- участник, остальные получают заявки. Название необязательно у любого чата:
-- с одним человеком может быть несколько диалогов, и различать их нужно
-- как-то, кроме последнего сообщения.
--
-- Результат — `{chat_id, outcome}`:
--   created          — чат создан;
--   incoming_invite  — встречная заявка: этот же набор людей уже зовёт меня в
--                      чат, и вместо второго чата открывается их (решение
--                      человека, см. отчёт этапа 1).
-- Повтор собственного чата, в котором ещё не все приняли, — ошибка OPN01, id
-- того чата в `detail`.

create function public.create_chat(invitee_ids uuid[], chat_title text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  invitees uuid[];
  member_set uuid[];
  existing_chat uuid;
  new_chat uuid;
  inviter_name text;
  clean_title text := nullif(btrim(chat_title), '');
  invitee uuid;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if invitee_ids is null or cardinality(invitee_ids) = 0 or array_position(invitee_ids, null) is not null then
    raise exception 'Выберите, кого позвать' using errcode = '22023';
  end if;

  select array_agg(distinct x order by x) into invitees from unnest(invitee_ids) as x;

  if me = any (invitees) then
    raise exception 'Нельзя позвать самого себя' using errcode = '22023';
  end if;

  select display_name into inviter_name
  from public.profiles
  where id = me and deleted_at is null;

  if not found then
    raise exception 'Профиль удалён' using errcode = '42501';
  end if;

  if (select count(*) from public.profiles where id = any (invitees) and deleted_at is null)
    <> cardinality(invitees) then
    raise exception 'Пользователь не найден' using errcode = '22023';
  end if;

  -- Сюда встанет проверка блокировок (этап модерации): никого из invitees
  -- нельзя звать, если он заблокировал меня или я его.

  select array_agg(x order by x) into member_set from unnest(invitees || me) as x;

  -- Два одновременных нажатия (или встречные создания с обеих сторон) иначе
  -- оба не нашли бы существующего чата и создали по своему.
  perform pg_advisory_xact_lock(hashtextextended('chat_set:' || array_to_string(member_set, ','), 0));

  select c.id into existing_chat
  from public.chats c
  join public.chat_invites i on i.chat_id = c.id and i.invitee_id = me and i.status <> 'accepted'
  where c.founding_member_ids = member_set
    and c.deleted_at is null
  order by i.created_at desc
  limit 1;

  if existing_chat is not null then
    return jsonb_build_object('chat_id', existing_chat, 'outcome', 'incoming_invite');
  end if;

  select c.id into existing_chat
  from public.chats c
  where c.created_by = me
    and c.founding_member_ids = member_set
    and c.deleted_at is null
    and exists (
      select 1 from public.chat_invites i where i.chat_id = c.id and i.status <> 'accepted'
    )
  limit 1;

  if existing_chat is not null then
    raise exception 'Вы уже позвали этих людей, и ответили ещё не все'
      using errcode = 'OPN01', detail = existing_chat::text;
  end if;

  insert into public.chats (kind, title, created_by, founding_member_ids)
  values (
    case when cardinality(invitees) = 1 then 'direct' else 'group' end,
    clean_title,
    me,
    member_set
  )
  returning id into new_chat;

  insert into public.chat_members (chat_id, user_id) values (new_chat, me);

  insert into public.chat_invites (chat_id, inviter_id, invitee_id)
  select new_chat, me, x from unnest(invitees) as x;

  -- Заявка обязана сохраниться, даже если Realtime недоступен.
  begin
    foreach invitee in array invitees loop
      perform realtime.send(
        jsonb_build_object(
          'chat_id', new_chat,
          'inviter_id', me,
          'inviter_name', inviter_name,
          'chat_title', clean_title
        ),
        'invite',
        'user:' || invitee::text,
        true
      );
    end loop;
  exception
    when others then null;
  end;

  return jsonb_build_object('chat_id', new_chat, 'outcome', 'created');
end;
$$;

revoke execute on function public.create_chat(uuid[], text) from public, anon;
grant execute on function public.create_chat(uuid[], text) to authenticated;

-- =============================================================================
-- Ответ на заявку
-- =============================================================================

create function public.accept_chat_invite(target_chat uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  invite public.chat_invites%rowtype;
  member record;
  joiner_name text;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  select * into invite
  from public.chat_invites
  where chat_id = target_chat and invitee_id = me
  for update;

  if not found then
    raise exception 'Заявка не найдена' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.chats where id = target_chat and deleted_at is null) then
    raise exception 'Чат не найден' using errcode = 'P0002';
  end if;

  if invite.status = 'accepted' then
    return;
  end if;

  update public.chat_invites
  set status = 'accepted', accepted_at = now()
  where id = invite.id;

  insert into public.chat_members (chat_id, user_id)
  values (target_chat, me)
  on conflict (chat_id, user_id) do nothing;

  select display_name into joiner_name from public.profiles where id = me;

  begin
    -- Все, кто смотрит чат, обновляют состав участников.
    perform realtime.send(
      jsonb_build_object('chat_id', target_chat, 'user_id', me, 'user_name', joiner_name),
      'member_joined',
      'chat:' || target_chat::text,
      true
    );

    -- Участники обновляют свой список чатов, где бы они ни были.
    for member in
      select user_id from public.chat_members where chat_id = target_chat and user_id <> me
    loop
      perform realtime.send(
        jsonb_build_object('chat_id', target_chat, 'user_id', me, 'user_name', joiner_name),
        'member_joined',
        'user:' || member.user_id::text,
        true
      );
    end loop;

    -- Другие устройства самого приглашённого.
    perform realtime.send(
      jsonb_build_object('chat_id', target_chat),
      'invite_changed',
      'user:' || me::text,
      true
    );
  exception
    when others then null;
  end;
end;
$$;

revoke execute on function public.accept_chat_invite(uuid) from public, anon;
grant execute on function public.accept_chat_invite(uuid) to authenticated;

create function public.decline_chat_invite(target_chat uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  invite public.chat_invites%rowtype;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  select * into invite
  from public.chat_invites
  where chat_id = target_chat and invitee_id = me
  for update;

  if not found then
    raise exception 'Заявка не найдена' using errcode = 'P0002';
  end if;

  if invite.status = 'declined' then
    return;
  end if;

  -- Отказ от принятой заявки — это уже выход из чата, а не ответ на заявку.
  if invite.status = 'accepted' then
    raise exception 'Заявка уже принята' using errcode = '22023';
  end if;

  update public.chat_invites
  set status = 'declined', declined_at = now()
  where id = invite.id;

  -- Отказ не рассылается в чат и создателю: его видит только сам отказавший,
  -- на своих устройствах.
  begin
    perform realtime.send(
      jsonb_build_object('chat_id', target_chat),
      'invite_changed',
      'user:' || me::text,
      true
    );
  exception
    when others then null;
  end;
end;
$$;

revoke execute on function public.decline_chat_invite(uuid) from public, anon;
grant execute on function public.decline_chat_invite(uuid) to authenticated;

-- =============================================================================
-- Последние сообщения нескольких чатов разом
-- =============================================================================
--
-- Карточка заявки показывает несколько последних сообщений. Запрос на каждую
-- заявку — N+1; эта функция отдаёт по `per_chat` сообщений на чат за один
-- проход. security invoker: сообщения видны ровно так, как их видит RLS.

create function public.latest_chat_messages(chat_ids uuid[], per_chat int default 3)
returns setof public.messages
language sql
stable
security invoker
set search_path = public
as $$
  select m.*
  from unnest(chat_ids) as target(id)
  cross join lateral (
    select *
    from public.messages
    where chat_id = target.id and deleted_at is null
    order by created_at desc
    limit least(greatest(per_chat, 1), 20)
  ) m;
$$;

grant execute on function public.latest_chat_messages(uuid[], int) to authenticated;

-- =============================================================================
-- Старый путь открытия диалога
-- =============================================================================
--
-- Создавал чат сразу с обоими участниками — без согласия второго.

drop function public.get_or_create_direct_chat(uuid);
