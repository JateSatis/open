-- Приватность, этап 3: заявки на диалог и действия блокировки и жалобы.
--
-- Личку начинает друг — сразу диалог: оба участники, публичен с первого
-- сообщения. Не-друг — заявка: чат с `request_pending`, инициатор участник,
-- второму — `chat_invites`, и ровно одно текстовое сообщение, вставленное
-- той же транзакцией. До принятия чат видят только двое (политики —
-- в миграции видимости), второе сообщение, медиа, голос, пересылку и звонок
-- база отвергает (OPN07) триггерами — какой бы путь вставки ни выбрал клиент.
-- Принятие снимает признак: с этой секунды чат — обычная публичная личка,
-- вместе с текстом заявки. Отклонённая не публикуется никогда.
--
-- Повторы считаются по паре в `dialogue_requests`: отказ или отмена своей
-- неотвеченной заявки — следующая не раньше чем через dialogue_retry_days,
-- после dialogue_max_refusals — никогда, пока второй сам не напишет. Отказ
-- отправителю не раскрывается: отмена считается так же, и ответ на повтор
-- один и тот же.
--
-- Коды отказов: OPN07 — заявка ещё не принята; OPN08 — «Пользователь
-- недоступен» (блокировка; заблокированному о ней не сообщается); OPN09 —
-- повторная заявка рано или больше нельзя; OPN10 — лимит обращений к
-- не-друзьям за сутки; OPN11 — автоограничение; OPN12 — лимит жалоб.

-- =============================================================================
-- Проверки, общие для создания чатов и приглашений
-- =============================================================================

/** Повторная заявка той же паре: OPN09, если рано или отказов уже слишком много. */
create function public.check_dialogue_retry(p_me uuid, p_peer uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  baseline timestamptz;
  refusals int;
  last_closed timestamptz;
begin
  -- Второй сам написал мне или принял мою заявку — счёт отказов с нуля.
  select greatest(
    (select max(d.created_at) from public.dialogue_requests d
      where d.requester_id = p_peer and d.addressee_id = p_me),
    (select max(d.closed_at) from public.dialogue_requests d
      where d.requester_id = p_me and d.addressee_id = p_peer and d.outcome = 'accepted')
  ) into baseline;

  select count(*), max(d.closed_at) into refusals, last_closed
  from public.dialogue_requests d
  where d.requester_id = p_me
    and d.addressee_id = p_peer
    and d.outcome in ('declined', 'cancelled')
    and (baseline is null or d.closed_at > baseline);

  if refusals >= public.safety_int('dialogue_max_refusals')
    or (
      refusals > 0
      and last_closed > now() - make_interval(days => public.safety_int('dialogue_retry_days'))
    )
  then
    raise exception 'Новую заявку этому человеку отправить пока нельзя' using errcode = 'OPN09';
  end if;
end;
$$;

/** Отказ действия по автоограничению — без подробностей. */
create function public.require_not_restricted(p_me uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.contact_restricted(p_me) then
    raise exception 'Сейчас вы не можете обращаться к людям, которые вам не друзья. Попробуйте позже'
      using errcode = 'OPN11';
  end if;
end;
$$;

-- =============================================================================
-- Создание чата
-- =============================================================================

drop function public.create_chat(uuid[], text, text);

/**
 * Один позванный — личка, несколько — группа. Личка с другом — сразу диалог.
 * Личка с не-другом — заявка: без `request_text` функция только проверяет,
 * можно ли (блокировка, ограничение, повтор, частота), и отвечает
 * `request_needed`, ничего не создавая; с текстом — создаёт чат, заявку и
 * первое сообщение одной транзакцией. Встречная заявка тех же людей —
 * `incoming_invite`, повтор своего набора — OPN01, как раньше.
 */
create function public.create_chat(
  invitee_ids uuid[],
  chat_title text default null,
  chat_avatar_url text default null,
  request_text text default null
)
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
  pending_mine public.chats;
  new_chat uuid;
  inviter_name text;
  clean_title text := nullif(btrim(chat_title), '');
  clean_avatar text;
  clean_text text := nullif(btrim(coalesce(request_text, '')), '');
  invitee uuid;
  is_direct boolean;
  peer uuid;
  strangers uuid[];
  is_request boolean;
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

  is_direct := cardinality(invitees) = 1;

  if not is_direct then
    clean_avatar := public.clean_group_avatar_url(chat_avatar_url);
  end if;

  if exists (select 1 from unnest(invitees) as x where public.blocked_pair(me, x)) then
    raise exception 'Пользователь недоступен' using errcode = 'OPN08';
  end if;

  select coalesce(array_agg(x order by x), '{}') into strangers
  from unnest(invitees) as x
  where not public.are_friends(me, x);

  peer := case when is_direct then invitees[1] end;
  is_request := is_direct and cardinality(strangers) > 0;

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

  select c.* into pending_mine
  from public.chats c
  where c.created_by = me
    and c.founding_member_ids = member_set
    and c.deleted_at is null
    and exists (
      select 1 from public.chat_invites i where i.chat_id = c.id and i.status <> 'accepted'
    )
  limit 1;

  if pending_mine.id is not null then
    -- Моя заявка ещё висит, а мы тем временем подружились: другу пишут
    -- сразу — заявка становится обычной личкой.
    if is_direct and not is_request and pending_mine.request_pending then
      perform public.open_dialogue_request(pending_mine.id, peer);

      return jsonb_build_object('chat_id', pending_mine.id, 'outcome', 'created');
    end if;

    raise exception 'Вы уже позвали этих людей, и ответили ещё не все'
      using errcode = 'OPN01', detail = pending_mine.id::text;
  end if;

  if cardinality(strangers) > 0 then
    perform public.require_not_restricted(me);
  end if;

  if is_request then
    perform public.check_dialogue_retry(me, peer);
  end if;

  perform public.check_contact_request_limit(me, cardinality(strangers));

  if is_request and clean_text is null then
    return jsonb_build_object('chat_id', null, 'outcome', 'request_needed');
  end if;

  insert into public.chats (kind, title, avatar_url, created_by, founding_member_ids, request_pending)
  values (
    case when is_direct then 'direct' else 'group' end,
    clean_title,
    clean_avatar,
    me,
    member_set,
    is_request
  )
  returning id into new_chat;

  insert into public.chat_members (chat_id, user_id) values (new_chat, me);

  if is_direct and not is_request then
    insert into public.chat_members (chat_id, user_id) values (new_chat, peer);
  else
    insert into public.chat_invites (chat_id, inviter_id, invitee_id)
    select new_chat, me, x from unnest(invitees) as x;
  end if;

  if cardinality(strangers) > 0 then
    insert into public.contact_request_log (requester_id, kind)
    select me, case when is_direct then 'dialogue' else 'group_invite' end
    from unnest(strangers);
  end if;

  if is_request then
    insert into public.dialogue_requests (chat_id, requester_id, addressee_id)
    values (new_chat, me, peer);
  end if;

  -- Текст заявки — первое сообщение. Другу текст тоже можно передать: он
  -- просто становится первым сообщением диалога.
  if is_direct and clean_text is not null then
    insert into public.messages (chat_id, author_id, kind, text)
    values (new_chat, me, 'text', clean_text);
  end if;

  if is_direct and not is_request then
    perform public.notify_chat_changed(new_chat);
  else
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
  end if;

  return jsonb_build_object('chat_id', new_chat, 'outcome', 'created');
end;
$$;

/**
 * Заявка на диалог становится обычной личкой: второй — участник, признак
 * снят, история пары — «принята». Зовут принятие заявки и создание лички
 * с другом поверх висящей заявки.
 */
create function public.open_dialogue_request(p_chat uuid, p_peer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_invites
  set status = 'accepted', accepted_at = now()
  where chat_id = p_chat and invitee_id = p_peer and status <> 'accepted';

  insert into public.chat_members (chat_id, user_id)
  values (p_chat, p_peer)
  on conflict (chat_id, user_id) do nothing;

  update public.chats set request_pending = false where id = p_chat and request_pending;

  update public.dialogue_requests
  set outcome = 'accepted', closed_at = now()
  where chat_id = p_chat and outcome is distinct from 'accepted';

  perform public.notify_chat_changed(p_chat);
end;
$$;

-- =============================================================================
-- Ответ на заявку
-- =============================================================================

create or replace function public.accept_chat_invite(target_chat uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  invite public.chat_invites%rowtype;
  chat public.chats;
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

  select * into chat from public.chats where id = target_chat and deleted_at is null for update;

  if chat.id is null then
    raise exception 'Чат не найден' using errcode = 'P0002';
  end if;

  if invite.status = 'accepted' then
    return;
  end if;

  if public.blocked_pair(me, invite.inviter_id) then
    raise exception 'Пользователь недоступен' using errcode = 'OPN08';
  end if;

  if chat.request_pending then
    perform public.open_dialogue_request(target_chat, me);
  else
    update public.chat_invites
    set status = 'accepted', accepted_at = now()
    where id = invite.id;

    insert into public.chat_members (chat_id, user_id)
    values (target_chat, me)
    on conflict (chat_id, user_id) do nothing;
  end if;

  if chat.kind = 'group' then
    perform public.post_member_event(target_chat, 'member_joined', me);

    -- Группа осталась без участников, пока заявка ждала, — принявший
    -- становится её владельцем.
    update public.chats set owner_id = me where id = target_chat and owner_id is null;
  end if;

  select display_name into joiner_name from public.profiles where id = me;

  begin
    perform realtime.send(
      jsonb_build_object('chat_id', target_chat, 'user_id', me, 'user_name', joiner_name),
      'member_joined',
      'chat:' || target_chat::text,
      true
    );

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

create or replace function public.decline_chat_invite(target_chat uuid)
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

  update public.dialogue_requests
  set outcome = 'declined', closed_at = now()
  where chat_id = target_chat and outcome is null;

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

create or replace function public.delete_direct_chat(target_chat uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  chat public.chats;
  live uuid;
  member record;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  select * into chat from public.chats where id = target_chat for update;

  if chat.id is null then
    raise exception 'Чат не найден' using errcode = 'P0002';
  end if;

  if chat.deleted_at is not null then
    return;
  end if;

  if chat.kind <> 'direct' then
    raise exception 'Удалить для всех можно только личный диалог' using errcode = '22023';
  end if;

  if not exists (select 1 from public.chat_members where chat_id = target_chat and user_id = me) then
    raise exception 'Удалить диалог может только его участник' using errcode = '42501';
  end if;

  -- Отмена своей неотвеченной заявки — для повторов то же, что отказ:
  -- удалить и создать заново не обходит правило.
  update public.dialogue_requests
  set outcome = 'cancelled', closed_at = now()
  where chat_id = target_chat and outcome is null and requester_id = me;

  select id into live from public.streams where chat_id = target_chat and status = 'live';

  if live is not null then
    perform public.finish_stream(live, 'chat_deleted');
  end if;

  update public.messages
  set deleted_at = now()
  where chat_id = target_chat and deleted_at is null;

  update public.chats set deleted_at = now() where id = target_chat;

  perform public.notify_chat_changed(target_chat);

  -- Подписчики и ещё не ответившие (у них заявка в «Заявках») убирают чат
  -- из своих списков.
  begin
    for member in
      select subscriber_id as user_id from public.subscriptions where chat_id = target_chat
    loop
      perform realtime.send(
        jsonb_build_object('chat_id', target_chat),
        'chat_changed',
        'user:' || member.user_id::text,
        true
      );
    end loop;

    for member in
      select invitee_id as user_id from public.chat_invites
      where chat_id = target_chat and status <> 'accepted' and invitee_id is not null
    loop
      perform realtime.send(
        jsonb_build_object('chat_id', target_chat),
        'invite_changed',
        'user:' || member.user_id::text,
        true
      );
    end loop;
  exception
    when others then null;
  end;
end;
$$;

-- =============================================================================
-- Инварианты заявки и блокировки — на самой вставке
-- =============================================================================
--
-- Триггер, а не проверки в каждой функции: сообщение в чат попадает прямым
-- INSERT, send_media_message, send_voice_message, forward_messages,
-- forward_comments, publish_pop… — любая новая дорога пройдёт тот же путь.

/**
 * Личка-заявка: у инициатора ровно одно сообщение, и оно текст (правкой в
 * медиа его не превратить). Общая личка двоих, между которыми блокировка: не
 * пишет никто. Системные строки сервера (звонки, состав) не проверяются.
 */
create function public.guard_message_contact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chat public.chats;
  other uuid;
begin
  if new.system_event is not null then
    return new;
  end if;

  select * into chat from public.chats where id = new.chat_id;

  if chat.kind is distinct from 'direct' then
    return new;
  end if;

  if chat.request_pending then
    -- Параллельные вставки в одну заявку — по очереди, и каждая видит
    -- предыдущую; принятие могло успеть снять признак.
    perform pg_advisory_xact_lock(hashtextextended('dialogue_request:' || new.chat_id::text, 0));
    select * into chat from public.chats where id = new.chat_id;
  end if;

  if chat.request_pending then
    if new.kind <> 'text' then
      raise exception 'Пока заявку не приняли, можно отправить только текст'
        using errcode = 'OPN07';
    end if;

    if tg_op = 'INSERT' and (
      new.author_id is distinct from chat.created_by
      or exists (select 1 from public.messages m where m.chat_id = new.chat_id)
    ) then
      raise exception 'Писать можно, когда собеседник примет заявку' using errcode = 'OPN07';
    end if;
  end if;

  if tg_op = 'INSERT' and new.author_id is not null then
    select x into other
    from unnest(chat.founding_member_ids) as x
    where x <> new.author_id
    limit 1;

    if public.blocked_pair(new.author_id, other) then
      raise exception 'Пользователь недоступен' using errcode = 'OPN08';
    end if;
  end if;

  return new;
end;
$$;

create trigger messages_guard_contact
  before insert or update of kind on public.messages
  for each row execute function public.guard_message_contact();

/** Звонок: в заявку — нельзя, в общую личку двоих с блокировкой — тоже. */
create function public.guard_stream_contact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chat public.chats;
  other uuid;
begin
  select * into chat from public.chats where id = new.chat_id;

  if chat.request_pending then
    raise exception 'Позвонить можно, когда собеседник примет заявку' using errcode = 'OPN07';
  end if;

  if chat.kind = 'direct' then
    select x into other
    from unnest(chat.founding_member_ids) as x
    where x <> new.host_id
    limit 1;

    if public.blocked_pair(new.host_id, other) then
      raise exception 'Пользователь недоступен' using errcode = 'OPN08';
    end if;
  end if;

  return new;
end;
$$;

create trigger streams_guard_contact
  before insert on public.streams
  for each row execute function public.guard_stream_contact();

-- Просмотр заявки до принятия не засчитывается: отправитель не узнаёт, что
-- её открыли.
create or replace function public.record_message_views(
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
  is_member boolean;
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

  if exists (select 1 from public.chats where id = target_chat and request_pending) then
    return;
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

  is_member := exists (
    select 1 from public.chat_members
    where chat_id = target_chat and user_id = viewer
  );

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
        unique_views_count = m.unique_views_count + case when u.first_view then 1 else 0 end,
        member_views_count = m.member_views_count + case when is_member then 1 else 0 end,
        member_unique_views_count = m.member_unique_views_count
          + case when is_member and u.first_view then 1 else 0 end
    from upserted u
    where m.id = u.message_id
    returning m.id
  )
  select coalesce(array_agg(id), '{}') into counted from bumped;

  if is_member then
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

  -- Просмотр участника скрытого чата — это его «прочитал сейчас»: сигнал
  -- в общий топик выдал бы момент. Остальные увидят числа при перечитывании.
  if is_member and (select time_restricted from public.chats where id = target_chat) then
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

-- =============================================================================
-- Блокировка
-- =============================================================================

/**
 * Заблокировать человека. Одной транзакцией рвутся дружба и заявки в друзья
 * пары, висящие заявки в чаты в обе стороны и заявки на диалог. Повторный
 * вызов ничего не меняет. Заблокированному не сообщается ничего.
 */
create function public.block_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if p_user is null or p_user = me then
    raise exception 'Нельзя заблокировать самого себя' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Пользователь не найден' using errcode = '22023';
  end if;

  -- Та же блокировка пары, что у заявок в друзья: встречное «Добавить» не
  -- проскочит между вставкой блокировки и разрывом дружбы.
  perform public.lock_friend_pair(me, p_user);

  insert into public.blocks (blocker_id, blocked_id)
  values (me, p_user)
  on conflict (blocker_id, blocked_id) do nothing;

  delete from public.friendships f
  where least(f.requester_id, f.addressee_id) = least(me, p_user)
    and greatest(f.requester_id, f.addressee_id) = greatest(me, p_user);

  -- Его заявки мне — мой отказ; мои ему — отменены, как будто их не было.
  update public.chat_invites
  set status = 'declined', declined_at = now()
  where status = 'pending' and inviter_id = p_user and invitee_id = me;

  delete from public.chat_invites
  where status = 'pending' and inviter_id = me and invitee_id = p_user;

  update public.dialogue_requests
  set outcome = case when requester_id = me then 'cancelled' else 'declined' end,
      closed_at = now()
  where outcome is null
    and ((requester_id = me and addressee_id = p_user) or (requester_id = p_user and addressee_id = me));

  begin
    perform realtime.send(jsonb_build_object('user_id', p_user), 'invite_changed', 'user:' || me::text, true);
    perform realtime.send(jsonb_build_object('user_id', me), 'invite_changed', 'user:' || p_user::text, true);
  exception
    when others then null;
  end;
end;
$$;

/** Разблокировать. Дружба и заявки не восстанавливаются. */
create function public.unblock_user(p_user uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = p_user
$$;

/** Мои заблокированные, свежие первыми, страницами. */
create function public.list_blocked_users(
  p_limit int default 30,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  block_id uuid,
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
  select b.id, b.created_at, p.id, p.display_name, p.username, p.avatar_url
  from public.blocks b
  join public.profiles p on p.id = b.blocked_id and p.deleted_at is null
  where b.blocker_id = me
    and (
      p_before_created_at is null
      or (b.created_at, b.id) < (p_before_created_at, p_before_id)
    )
  order by b.created_at desc, b.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

-- =============================================================================
-- Жалоба
-- =============================================================================

/**
 * Пожаловаться на человека — на его заявку на диалог (`p_chat`) или на
 * профиль. Повтор того же на того же по той же цели строк не плодит. С
 * `p_block` — заодно заблокировать, той же транзакцией.
 */
create function public.report_user(
  p_user uuid,
  p_reason text,
  p_chat uuid default null,
  p_comment text default null,
  p_block boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if p_user is null or p_user = me then
    raise exception 'Нельзя пожаловаться на самого себя' using errcode = '22023';
  end if;

  if p_reason is null or p_reason not in ('spam', 'harassment', 'threats', 'other') then
    raise exception 'Неизвестная причина жалобы' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Пользователь не найден' using errcode = '22023';
  end if;

  -- Жалоба на заявку — только на ту, что прислали мне.
  if p_chat is not null and not exists (
    select 1 from public.chats c
    join public.chat_invites i on i.chat_id = c.id
    where c.id = p_chat and c.kind = 'direct'
      and i.invitee_id = me and i.inviter_id = p_user
  ) then
    raise exception 'Заявка не найдена' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('reports_of:' || me::text, 0));

  if not exists (
    select 1 from public.reports r
    where r.reporter_id = me and r.target_user_id = p_user
      and r.target_kind = case when p_chat is null then 'profile' else 'dialogue_request' end
      and r.chat_id is not distinct from p_chat
  ) then
    if (
      select count(*) from public.reports r
      where r.reporter_id = me and r.created_at > now() - interval '1 day'
    ) >= public.safety_int('reports_per_day') then
      raise exception 'Слишком много жалоб, попробуйте позже' using errcode = 'OPN12';
    end if;

    insert into public.reports (reporter_id, target_user_id, target_kind, chat_id, reason, comment)
    values (
      me,
      p_user,
      case when p_chat is null then 'profile' else 'dialogue_request' end,
      p_chat,
      p_reason,
      left(clean_comment, 2000)
    )
    on conflict do nothing;
  end if;

  if p_block then
    perform public.block_user(p_user);
  end if;
end;
$$;

-- =============================================================================
-- Права
-- =============================================================================

revoke execute on function public.check_dialogue_retry(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.require_not_restricted(uuid) from public, anon, authenticated;
revoke execute on function public.open_dialogue_request(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.guard_message_contact() from public, anon, authenticated;
revoke execute on function public.guard_stream_contact() from public, anon, authenticated;

revoke execute on function public.create_chat(uuid[], text, text, text) from public, anon;
revoke execute on function public.accept_chat_invite(uuid) from public, anon;
revoke execute on function public.decline_chat_invite(uuid) from public, anon;
revoke execute on function public.delete_direct_chat(uuid) from public, anon;
revoke execute on function public.record_message_views(uuid, uuid[], uuid) from public, anon;
revoke execute on function public.block_user(uuid) from public, anon;
revoke execute on function public.unblock_user(uuid) from public, anon;
revoke execute on function public.list_blocked_users(int, timestamptz, uuid) from public, anon;
revoke execute on function public.report_user(uuid, text, uuid, text, boolean) from public, anon;

grant execute on function public.create_chat(uuid[], text, text, text) to authenticated;
grant execute on function public.accept_chat_invite(uuid) to authenticated;
grant execute on function public.decline_chat_invite(uuid) to authenticated;
grant execute on function public.delete_direct_chat(uuid) to authenticated;
grant execute on function public.record_message_views(uuid, uuid[], uuid) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.list_blocked_users(int, timestamptz, uuid) to authenticated;
grant execute on function public.report_user(uuid, text, uuid, text, boolean) to authenticated;
