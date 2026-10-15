-- Управление группой, удаление личного диалога и поиск внутри чата.
--
-- Группой управляет один владелец: название, фото, описание, `@имя` и
-- удаление участников. Право — одна функция `can_manage_chat`: будущие админы
-- добавятся в ней, а не в каждой функции записи (так же у каналов сделано
-- `can_publish_in_channel`). `created_by` остаётся историей «кто создал»:
-- владение переходит, создатель — нет.
--
-- Состав группы меняется только функциями, и каждое изменение ложится в
-- переписку системной строкой: пригласил(а), вступил(а), покинул(а),
-- удалил(а), «Владельцем стал(а)». Строка ссылается на людей, а не хранит их
-- имена: переименовался — строка показывает новое имя. Текст сообщения —
-- запасной, для превью и старых версий приложения.

-- =============================================================================
-- Владелец
-- =============================================================================

-- `on delete set null`: удаление аккаунта не рушит группу. Владение до этого
-- успевает перейти — триггер на удаление профиля ниже.
alter table public.chats
  add column owner_id uuid references public.profiles (id) on delete set null,
  add constraint chats_owner_only_group check (owner_id is null or kind = 'group');

create index chats_owner_id_idx on public.chats (owner_id) where owner_id is not null;

-- Существующим группам: создатель, если он ещё в группе, иначе самый давний
-- участник. Группа без участников остаётся без владельца.
update public.chats c
set owner_id = coalesce(
  (
    select m.user_id from public.chat_members m
    where m.chat_id = c.id and m.user_id = c.created_by
  ),
  (
    select m.user_id from public.chat_members m
    where m.chat_id = c.id
    order by m.joined_at, m.user_id
    limit 1
  )
)
where c.kind = 'group';

-- Новая группа — владелец её создатель. Триггером, а не правкой
-- `create_chat`: владелец появляется у группы, кто бы её ни создал.
create function public.set_group_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kind = 'group' and new.owner_id is null then
    new.owner_id := new.created_by;
  end if;

  return new;
end;
$$;

create trigger chats_set_group_owner
  before insert on public.chats
  for each row execute function public.set_group_owner();

revoke execute on function public.set_group_owner() from public, anon, authenticated;

/**
 * Может ли `who` настраивать группу и удалять её участников. Сейчас — только
 * владелец, и только пока он участник. Единственное место этого правила.
 */
create function public.can_manage_chat(target_chat uuid, who uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chats c
    join public.chat_members m on m.chat_id = c.id and m.user_id = who
    where c.id = target_chat
      and c.kind = 'group'
      and c.deleted_at is null
      and c.owner_id = who
  );
$$;

revoke execute on function public.can_manage_chat(uuid, uuid) from public, anon;
grant execute on function public.can_manage_chat(uuid, uuid) to authenticated;

-- Прямой правки названия больше нет: только `set_chat_title`, с правом
-- владельца. Иначе создатель, переставший быть владельцем, переименовывал бы
-- группу мимо функции.
drop policy "chats are editable by their creator" on public.chats;
revoke update on public.chats from anon, authenticated;

-- =============================================================================
-- Описание
-- =============================================================================

-- Граница — против мусора, а не продуктовый лимит: тот живёт на клиенте.
alter table public.chats
  add column description text,
  add constraint chats_description_only_group check (description is null or kind = 'group'),
  add constraint chats_description_length check (char_length(description) <= 4000);

-- =============================================================================
-- Рассылка «чат изменился»
-- =============================================================================

/**
 * Сигнал `chat_changed`: в топик чата — всем, у кого он открыт (и
 * посторонним: страница и переписка публичны), и лично — участникам, ещё не
 * ответившим на заявку и `extra` (ушедшему, удалённому). Payload — только
 * подсказка: клиент перечитывает чат из базы. Изменение обязано сохраниться,
 * даже если Realtime недоступен.
 */
create function public.notify_chat_changed(target_chat uuid, extra uuid[] default '{}')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  member record;
begin
  begin
    perform realtime.send(
      jsonb_build_object('chat_id', target_chat),
      'chat_changed',
      'chat:' || target_chat::text,
      true
    );

    for member in
      select user_id from public.chat_members where chat_id = target_chat
      union
      select invitee_id from public.chat_invites
      where chat_id = target_chat and status = 'pending' and invitee_id is not null
      union
      select unnest(coalesce(extra, '{}'))
    loop
      perform realtime.send(
        jsonb_build_object('chat_id', target_chat),
        'chat_changed',
        'user:' || member.user_id::text,
        true
      );
    end loop;
  exception
    when others then null;
  end;
end;
$$;

revoke execute on function public.notify_chat_changed(uuid, uuid[]) from public, anon, authenticated;

-- =============================================================================
-- Системные строки состава
-- =============================================================================

alter table public.messages drop constraint messages_system_event_check;
alter table public.messages drop constraint messages_system_event_has_stream;

alter table public.messages
  -- Второй человек события: кого пригласили, кого удалили, кто стал
  -- владельцем. Первый — автор строки (`author_id`): кто пригласил, вступил,
  -- ушёл, удалил. Удалённый аккаунт — пустая ссылка, «Удалённый аккаунт».
  add column system_user_id uuid references public.profiles (id) on delete set null,
  add constraint messages_system_event_check check (
    system_event in (
      'call_started',
      'call_ended',
      'member_invited',
      'member_joined',
      'member_left',
      'member_removed',
      'owner_changed'
    )
  ),
  -- Звонковые события — со звонком, остальные — без.
  add constraint messages_call_event_has_stream check (
    (stream_id is not null) = coalesce(system_event in ('call_started', 'call_ended'), false)
  ),
  add constraint messages_system_user_only_member_event check (
    system_user_id is null or system_event in ('member_invited', 'member_removed', 'owner_changed')
  );

create index messages_system_user_id_idx
  on public.messages (system_user_id)
  where system_user_id is not null;

/** Текст строки состава — как его пишет клиент (`memberEventText`). */
create function public.member_event_text(event text, actor_name text, subject_name text)
returns text
language sql
immutable
as $$
  select case event
    when 'member_invited' then
      coalesce(actor_name, 'Удалённый аккаунт') || ' пригласил(а) ' || coalesce(subject_name, 'Удалённый аккаунт')
    when 'member_joined' then coalesce(actor_name, 'Удалённый аккаунт') || ' вступил(а) в группу'
    when 'member_left' then coalesce(actor_name, 'Удалённый аккаунт') || ' покинул(а) группу'
    when 'member_removed' then
      coalesce(actor_name, 'Удалённый аккаунт') || ' удалил(а) ' || coalesce(subject_name, 'Удалённый аккаунт')
    when 'owner_changed' then 'Владельцем стал(а) ' || coalesce(subject_name, 'Удалённый аккаунт')
  end;
$$;

/**
 * Положить строку состава в переписку. Время — `clock_timestamp()`, а не
 * время транзакции: «покинул(а)» и «Владельцем стал(а)» одной транзакцией
 * должны встать в переписке по порядку.
 */
create function public.post_member_event(
  target_chat uuid,
  event text,
  actor uuid,
  subject uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.messages (chat_id, author_id, kind, text, system_event, system_user_id, created_at)
  values (
    target_chat,
    actor,
    'system',
    public.member_event_text(
      event,
      (select display_name from public.profiles where id = actor),
      (select display_name from public.profiles where id = subject)
    ),
    event,
    subject,
    clock_timestamp()
  );
end;
$$;

revoke execute on function public.post_member_event(uuid, text, uuid, uuid) from public, anon, authenticated;

-- Превью строки состава в «Чатах» — тем же текстом, нынешними именами.
create or replace function public.message_preview_text(m public.messages)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  voice_ms int;
  items int;
  fc public.comments;
begin
  if m.stream_id is not null then
    return '📞 Звонок';
  end if;

  if m.system_event in ('member_invited', 'member_joined', 'member_left', 'member_removed', 'owner_changed') then
    return public.member_event_text(
      m.system_event,
      (select display_name from public.profiles where id = m.author_id),
      (select display_name from public.profiles where id = m.system_user_id)
    );
  end if;

  if m.kind = 'forward' then
    select count(*) into items
    from public.forward_items
    where forward_id = m.id and deleted_at is null;

    return 'Переслано: ' || items || ' ' || case
      when items % 10 = 1 and items % 100 <> 11 then 'сообщение'
      when items % 10 between 2 and 4 and (items % 100 < 12 or items % 100 > 14) then 'сообщения'
      else 'сообщений'
    end;
  end if;

  if m.kind = 'comment_forward' then
    select * into fc from public.comments where id = m.forwarded_comment_id;

    return '💬 ' || coalesce(
      case when fc.deleted_at is null then fc.text end,
      case
        when fc.deleted_at is not null or fc.id is null then 'Комментарий удалён'
        when fc.kind = 'media' then '📷 Медиа'
        when fc.kind = 'voice' then '🎤 Голосовое сообщение'
      end,
      'Комментарий'
    );
  end if;

  if m.kind = 'media' and exists (
    select 1 from public.attachments where message_id = m.id and pop_id is not null
  ) then
    return '🎬 Pop' || coalesce(': ' || m.text, '');
  end if;

  if m.text is not null then
    return m.text;
  end if;

  if m.kind = 'media' then
    return '📷 Медиа';
  end if;

  if m.kind = 'voice' then
    select duration_ms into voice_ms
    from public.attachments
    where message_id = m.id
    limit 1;

    if voice_ms is not null then
      return format(
        '🎤 Голосовое сообщение (%s:%s)',
        greatest(voice_ms / 1000, 1) / 60,
        lpad((greatest(voice_ms / 1000, 1) % 60)::text, 2, '0')
      );
    end if;

    return '🎤 Голосовое сообщение';
  end if;

  return m.text;
end;
$$;

-- =============================================================================
-- Настройки группы — только владелец
-- =============================================================================

create or replace function public.set_chat_title(target_chat uuid, new_title text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  target_kind text;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  select kind into target_kind
  from public.chats
  where id = target_chat and deleted_at is null
  for update;

  if target_kind is null then
    raise exception 'Чат не найден' using errcode = 'P0002';
  end if;

  if target_kind <> 'group' then
    raise exception 'Название бывает только у группы' using errcode = '22023';
  end if;

  if not public.can_manage_chat(target_chat, me) then
    raise exception 'Менять название группы может только её владелец' using errcode = '42501';
  end if;

  update public.chats set title = nullif(btrim(new_title), '') where id = target_chat;

  perform public.notify_chat_changed(target_chat);
end;
$$;

create or replace function public.set_chat_avatar(target_chat uuid, new_avatar_url text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean text;
  target_kind text;
  previous text;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  select kind, avatar_url into target_kind, previous
  from public.chats
  where id = target_chat and deleted_at is null
  for update;

  if target_kind is null then
    raise exception 'Чат не найден' using errcode = 'P0002';
  end if;

  if target_kind <> 'group' then
    raise exception 'Фото бывает только у группы' using errcode = '22023';
  end if;

  if not public.can_manage_chat(target_chat, me) then
    raise exception 'Менять фото группы может только её владелец' using errcode = '42501';
  end if;

  clean := public.clean_group_avatar_url(new_avatar_url);

  update public.chats set avatar_url = clean where id = target_chat;

  perform public.notify_chat_changed(target_chat);

  return previous;
end;
$$;

create or replace function public.set_chat_username(target_chat uuid, new_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean text := nullif(btrim(new_username), '');
  target_kind text;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  select kind into target_kind
  from public.chats
  where id = target_chat and deleted_at is null
  for update;

  if target_kind is null then
    raise exception 'Чат не найден' using errcode = 'P0002';
  end if;

  if target_kind <> 'group' then
    raise exception 'Имя бывает только у группы' using errcode = '22023';
  end if;

  if not public.can_manage_chat(target_chat, me) then
    raise exception 'Менять имя группы может только её владелец' using errcode = '42501';
  end if;

  if clean is not null and clean !~ '^[A-Za-z0-9_]+$' then
    raise exception 'Имя может состоять только из латиницы, цифр и _' using errcode = '22023';
  end if;

  begin
    update public.chats set username = clean where id = target_chat;
  exception
    when unique_violation then
      raise exception 'Это имя уже занято' using errcode = 'OPN02';
  end;

  perform public.notify_chat_changed(target_chat);

  return clean;
end;
$$;

/** Задать или убрать (`null` / пустая строка) описание группы. Только владелец. */
create function public.set_chat_description(target_chat uuid, new_description text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  target_kind text;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  select kind into target_kind
  from public.chats
  where id = target_chat and deleted_at is null
  for update;

  if target_kind is null then
    raise exception 'Чат не найден' using errcode = 'P0002';
  end if;

  if target_kind <> 'group' then
    raise exception 'Описание бывает только у группы' using errcode = '22023';
  end if;

  if not public.can_manage_chat(target_chat, me) then
    raise exception 'Менять описание группы может только её владелец' using errcode = '42501';
  end if;

  update public.chats set description = nullif(btrim(new_description), '') where id = target_chat;

  perform public.notify_chat_changed(target_chat);
end;
$$;

revoke execute on function public.set_chat_description(uuid, text) from public, anon;
grant execute on function public.set_chat_description(uuid, text) to authenticated;

-- Сводка страницы: «владелец» — колонка владельца, а не создатель.
create or replace function public.chat_info_summary(target_chat uuid)
returns table (
  owner_id uuid,
  photos int,
  videos int,
  voices int,
  common_groups int
)
language sql
stable
security invoker
set search_path = public
as $$
  with chat as (
    select c.id, c.kind, c.owner_id
    from public.chats c
    where c.id = target_chat and c.deleted_at is null
  ),
  media as (
    select
      count(*) filter (where a.mime_type like 'image/%')::int as photos,
      count(*) filter (where a.mime_type like 'video/%')::int as videos
    from public.messages m
    join public.attachments a on a.message_id = m.id
    where m.chat_id = target_chat
      and m.kind = 'media'
      and m.deleted_at is null
      and a.pop_id is null
  ),
  voices as (
    select count(*)::int as voices
    from public.messages m
    where m.chat_id = target_chat
      and m.kind in ('voice', 'video_note')
      and m.deleted_at is null
  ),
  other as (
    select cm.user_id
    from chat
    join public.chat_members cm on cm.chat_id = chat.id
    where chat.kind = 'direct'
      and cm.user_id <> auth.uid()
      and exists (
        select 1 from public.chat_members mine
        where mine.chat_id = chat.id and mine.user_id = auth.uid()
      )
    limit 1
  )
  select
    chat.owner_id,
    media.photos,
    media.videos,
    voices.voices,
    coalesce((
      select count(*)::int
      from other
      join public.chat_members them on them.user_id = other.user_id
      join public.chats g on g.id = them.chat_id and g.kind = 'group' and g.deleted_at is null
      where exists (
        select 1 from public.chat_members me
        where me.chat_id = g.id and me.user_id = auth.uid()
      )
    ), 0)
  from chat, media, voices;
$$;

-- =============================================================================
-- Состав: выход, приглашение, удаление участника, отмена приглашения
-- =============================================================================

-- Уйти из чата прямым DELETE больше нельзя: так группа осталась бы без
-- владельца и без строки «покинул(а)». Только `leave_chat`.
drop policy "chat_members can remove themselves" on public.chat_members;
revoke delete on public.chat_members from anon, authenticated;

/**
 * Передать владение самому давнему из оставшихся участников, если группа
 * осталась без владельца-участника. Без участников — без владельца.
 * Отдаёт нового владельца или `null`.
 */
create function public.pass_chat_ownership(target_chat uuid, leaving uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  heir uuid;
begin
  select m.user_id into heir
  from public.chat_members m
  where m.chat_id = target_chat and m.user_id <> leaving
  order by m.joined_at, m.user_id
  limit 1;

  update public.chats set owner_id = heir where id = target_chat;

  if heir is not null then
    perform public.post_member_event(target_chat, 'owner_changed', null, heir);
  end if;

  return heir;
end;
$$;

revoke execute on function public.pass_chat_ownership(uuid, uuid) from public, anon, authenticated;

/**
 * Кому перейдёт группа, если владелец уйдёт сейчас: самый давний из
 * остальных участников. `null` — владелец последний. Для текста
 * подтверждения выхода; решает всё равно `leave_chat`.
 */
create function public.chat_heir(target_chat uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id
  from public.chats c
  join public.chat_members m on m.chat_id = c.id and m.user_id <> c.owner_id
  where c.id = target_chat and c.kind = 'group' and c.deleted_at is null
  order by m.joined_at, m.user_id
  limit 1;
$$;

revoke execute on function public.chat_heir(uuid) from public, anon;
grant execute on function public.chat_heir(uuid) to authenticated;

/**
 * Покинуть группу. Одной транзакцией: строка участника удаляется, в
 * переписку ложится «покинул(а)», а если уходит владелец — владение
 * переходит самому давнему участнику. Последний ушедший оставляет группу без
 * участников: переписка остаётся публичной, писать в неё некому.
 */
create function public.leave_chat(target_chat uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  chat public.chats;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  select * into chat from public.chats where id = target_chat and deleted_at is null for update;

  if chat.id is null then
    raise exception 'Чат не найден' using errcode = 'P0002';
  end if;

  -- Из диалога не уходят — его удаляют для обоих. Чат постов — дело канала.
  if chat.kind <> 'group' then
    raise exception 'Покинуть можно только группу' using errcode = '22023';
  end if;

  delete from public.chat_members where chat_id = target_chat and user_id = me;

  if not found then
    raise exception 'Вы не участник этой группы' using errcode = '42501';
  end if;

  perform public.post_member_event(target_chat, 'member_left', me);

  if chat.owner_id is not distinct from me or chat.owner_id is null then
    perform public.pass_chat_ownership(target_chat, me);
  end if;

  perform public.notify_chat_changed(target_chat, array[me]);

  begin
    perform realtime.send(
      jsonb_build_object('chat_id', target_chat),
      'membership_ended',
      'user:' || me::text,
      true
    );
  exception
    when others then null;
  end;
end;
$$;

revoke execute on function public.leave_chat(uuid) from public, anon;
grant execute on function public.leave_chat(uuid) to authenticated;

/**
 * Позвать людей в существующую группу. Может любой участник. Участником
 * человек становится, только приняв заявку (`accept_chat_invite`). Уже
 * участники и уже позванные пропускаются; отказавшийся или удалённый раньше
 * получает новую заявку. Отдаёт, скольких позвали на самом деле.
 */
create function public.invite_to_chat(target_chat uuid, invitee_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  chat public.chats;
  wanted uuid[];
  fresh uuid[];
  inviter_name text;
  invitee uuid;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if invitee_ids is null or cardinality(invitee_ids) = 0 or array_position(invitee_ids, null) is not null then
    raise exception 'Выберите, кого позвать' using errcode = '22023';
  end if;

  select array_agg(distinct x order by x) into wanted from unnest(invitee_ids) as x;

  if cardinality(wanted) > 50 then
    raise exception 'Слишком много людей за раз' using errcode = '22023';
  end if;

  select * into chat from public.chats where id = target_chat and deleted_at is null for update;

  if chat.id is null then
    raise exception 'Чат не найден' using errcode = 'P0002';
  end if;

  if chat.kind <> 'group' then
    raise exception 'Позвать можно только в группу' using errcode = '22023';
  end if;

  if not exists (select 1 from public.chat_members where chat_id = target_chat and user_id = me) then
    raise exception 'Звать в группу может только участник' using errcode = '42501';
  end if;

  if me = any (wanted) then
    raise exception 'Нельзя позвать самого себя' using errcode = '22023';
  end if;

  if (select count(*) from public.profiles where id = any (wanted) and deleted_at is null)
    <> cardinality(wanted) then
    raise exception 'Пользователь не найден' using errcode = '22023';
  end if;

  -- Сюда встанет проверка блокировок, как и в `create_chat`.

  select coalesce(array_agg(x order by x), '{}') into fresh
  from unnest(wanted) as x
  where not exists (select 1 from public.chat_members where chat_id = target_chat and user_id = x)
    and not exists (
      select 1 from public.chat_invites
      where chat_id = target_chat and invitee_id = x and status = 'pending'
    );

  if cardinality(fresh) = 0 then
    return 0;
  end if;

  -- Прежняя заявка (отклонённая или принятая до удаления из группы) — не
  -- публичная история: на её место встаёт новая, с новым позвавшим.
  delete from public.chat_invites
  where chat_id = target_chat and invitee_id = any (fresh) and status <> 'pending';

  insert into public.chat_invites (chat_id, inviter_id, invitee_id)
  select target_chat, me, x from unnest(fresh) as x;

  foreach invitee in array fresh loop
    perform public.post_member_event(target_chat, 'member_invited', me, invitee);
  end loop;

  select display_name into inviter_name from public.profiles where id = me;

  begin
    foreach invitee in array fresh loop
      perform realtime.send(
        jsonb_build_object(
          'chat_id', target_chat,
          'inviter_id', me,
          'inviter_name', inviter_name,
          'chat_title', chat.title
        ),
        'invite',
        'user:' || invitee::text,
        true
      );
    end loop;
  exception
    when others then null;
  end;

  perform public.notify_chat_changed(target_chat);

  return cardinality(fresh);
end;
$$;

revoke execute on function public.invite_to_chat(uuid, uuid[]) from public, anon;
grant execute on function public.invite_to_chat(uuid, uuid[]) to authenticated;

/**
 * Удалить участника из группы. Только тот, кто управляет группой, и не себя:
 * для этого — `leave_chat`. Удалённого можно позвать снова.
 */
create function public.remove_chat_member(target_chat uuid, target_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  chat public.chats;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  select * into chat from public.chats where id = target_chat and deleted_at is null for update;

  if chat.id is null then
    raise exception 'Чат не найден' using errcode = 'P0002';
  end if;

  if not public.can_manage_chat(target_chat, me) then
    raise exception 'Удалять участников может только владелец группы' using errcode = '42501';
  end if;

  if target_user = me then
    raise exception 'Себя не удаляют — из группы уходят' using errcode = '22023';
  end if;

  delete from public.chat_members where chat_id = target_chat and user_id = target_user;

  if not found then
    raise exception 'Этот человек не участник группы' using errcode = 'P0002';
  end if;

  perform public.post_member_event(target_chat, 'member_removed', me, target_user);
  perform public.notify_chat_changed(target_chat, array[target_user]);

  begin
    perform realtime.send(
      jsonb_build_object('chat_id', target_chat),
      'membership_ended',
      'user:' || target_user::text,
      true
    );
  exception
    when others then null;
  end;
end;
$$;

revoke execute on function public.remove_chat_member(uuid, uuid) from public, anon;
grant execute on function public.remove_chat_member(uuid, uuid) to authenticated;

/**
 * Отменить ещё не принятую заявку в группу. Только тот, кто управляет
 * группой. Заявка исчезает у позванного из «Заявок».
 */
create function public.cancel_chat_invite(target_chat uuid, target_user uuid)
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

  perform 1 from public.chats where id = target_chat and deleted_at is null for update;

  if not found then
    raise exception 'Чат не найден' using errcode = 'P0002';
  end if;

  if not public.can_manage_chat(target_chat, me) then
    raise exception 'Отменять приглашения может только владелец группы' using errcode = '42501';
  end if;

  delete from public.chat_invites
  where chat_id = target_chat and invitee_id = target_user and status <> 'accepted';

  if not found then
    raise exception 'Приглашение не найдено' using errcode = 'P0002';
  end if;

  perform public.notify_chat_changed(target_chat);

  begin
    perform realtime.send(
      jsonb_build_object('chat_id', target_chat),
      'invite_changed',
      'user:' || target_user::text,
      true
    );
  exception
    when others then null;
  end;
end;
$$;

revoke execute on function public.cancel_chat_invite(uuid, uuid) from public, anon;
grant execute on function public.cancel_chat_invite(uuid, uuid) to authenticated;

-- Принявший заявку в группу — строка «вступил(а)». Остальное — как было.
create or replace function public.accept_chat_invite(target_chat uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  invite public.chat_invites%rowtype;
  target_kind text;
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

  select kind into target_kind from public.chats where id = target_chat and deleted_at is null;

  if target_kind is null then
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

  if target_kind = 'group' then
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

-- Владелец удаляет аккаунт — владение переходит так же, как при выходе. До
-- удаления профиля: после него строка участника уже ушла бы каскадом.
create function public.pass_ownership_of_deleted_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  for target in
    select id from public.chats
    where owner_id = old.id and kind = 'group' and deleted_at is null
    for update
  loop
    perform public.pass_chat_ownership(target, old.id);
    perform public.notify_chat_changed(target);
  end loop;

  return old;
end;
$$;

create trigger profiles_pass_ownership_before_delete
  before delete on public.profiles
  for each row execute function public.pass_ownership_of_deleted_profile();

revoke execute on function public.pass_ownership_of_deleted_profile() from public, anon, authenticated;

-- =============================================================================
-- Удаление личного диалога — для обоих и для всех
-- =============================================================================

alter table public.streams drop constraint streams_end_reason_check;
alter table public.streams add constraint streams_end_reason_check check (
  end_reason in ('everyone_left', 'room_finished', 'abandoned', 'reconciled', 'chat_deleted')
);

/**
 * Удалить свой личный диалог для обоих и для всех, кто его читает. Мягко:
 * сообщения помечаются удалёнными тем же путём, что и `delete_messages`
 * (триггер `handle_messages_deleted` снимает закрепы, откатывает превью и
 * рассылает удаление — островки в других чатах показывают «оригинал
 * удалён»), затем помечается удалённым сам чат. Идущий звонок завершается.
 * Участники, заявки и подписки остаются строками: удалённый чат их не
 * показывает. Новый диалог с тем же человеком создаётся заново и пустым.
 */
create function public.delete_direct_chat(target_chat uuid)
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

revoke execute on function public.delete_direct_chat(uuid) from public, anon;
grant execute on function public.delete_direct_chat(uuid) to authenticated;

-- =============================================================================
-- Поиск по одному чату
-- =============================================================================
--
-- Тот же движок, что у поиска в «Чатах» (`search_tsquery`, `search_like`,
-- те же частичные индексы), но в одном чате и без опечаток: здесь человек
-- ищет конкретное сообщение, и «похожее» сбило бы счётчик «из N».
-- Чат — любой живой: читать его может кто угодно, искать — тоже.

/**
 * Совпадения в чате, свежие сверху, страницей. Курсор — время и id
 * последнего совпадения прошлой страницы.
 */
create function public.search_chat_messages(
  target_chat uuid,
  query text,
  before_created timestamptz default null,
  before_id uuid default null,
  page_size int default 30
)
returns table (
  message_id uuid,
  author_id uuid,
  author_name text,
  text text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  needle text;
  tsq tsquery;
  pattern text;
  use_like boolean;
  lim int := least(greatest(coalesce(page_size, 30), 1), 100);
begin
  if auth.uid() is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  needle := public.search_norm(query);

  if needle is null or needle = '' then
    return;
  end if;

  if not exists (select 1 from public.chats where id = target_chat and deleted_at is null) then
    return;
  end if;

  tsq := public.search_tsquery(needle);
  pattern := public.search_like(needle);
  use_like := char_length(needle) >= 3;

  return query
  select m.id, m.author_id, coalesce(p.display_name, p.username), m.text, m.created_at
  from public.messages m
  left join public.profiles p on p.id = m.author_id
  where m.chat_id = target_chat
    and m.deleted_at is null and m.kind in ('text', 'media') and m.text is not null
    and (before_created is null or (m.created_at, m.id) < (before_created, before_id))
    and (
      (tsq is not null and public.search_tsv(m.text) @@ tsq)
      or (use_like and public.search_norm(m.text) like pattern)
    )
  order by m.created_at desc, m.id desc
  limit lim;
end;
$$;

revoke execute on function public.search_chat_messages(uuid, text, timestamptz, uuid, int) from public, anon;
grant execute on function public.search_chat_messages(uuid, text, timestamptz, uuid, int) to authenticated;

/**
 * Сколько всего совпадений в чате — для «3 из N». Считает не дальше
 * 1000: больше человек всё равно не пролистает стрелками, а большой чат
 * не должен платить полным подсчётом за каждую букву.
 */
create function public.count_chat_search(target_chat uuid, query text)
returns int
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  needle text;
  tsq tsquery;
  pattern text;
  use_like boolean;
  total int;
begin
  if auth.uid() is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  needle := public.search_norm(query);

  if needle is null or needle = '' then
    return 0;
  end if;

  if not exists (select 1 from public.chats where id = target_chat and deleted_at is null) then
    return 0;
  end if;

  tsq := public.search_tsquery(needle);
  pattern := public.search_like(needle);
  use_like := char_length(needle) >= 3;

  select count(*) into total
  from (
    select 1
    from public.messages m
    where m.chat_id = target_chat
      and m.deleted_at is null and m.kind in ('text', 'media') and m.text is not null
      and (
        (tsq is not null and public.search_tsv(m.text) @@ tsq)
        or (use_like and public.search_norm(m.text) like pattern)
      )
    limit 1000
  ) hits;

  return total;
end;
$$;

revoke execute on function public.count_chat_search(uuid, text) from public, anon;
grant execute on function public.count_chat_search(uuid, text) to authenticated;

-- =============================================================================
-- Люди для приглашения
-- =============================================================================

/**
 * Люди по имени или `@имени`, страницей по алфавиту; пустой запрос — все.
 * Себя и удалённых нет. Курсор — имя и id последнего на прошлой странице.
 */
create function public.search_people(
  query text default null,
  after_name text default null,
  after_id uuid default null,
  page_size int default 30
)
returns table (
  id uuid,
  display_name text,
  username text,
  avatar_url text
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  needle text := public.search_norm(coalesce(query, ''));
  pattern text;
  user_pattern text;
  lim int := least(greatest(coalesce(page_size, 30), 1), 100);
begin
  if auth.uid() is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  pattern := case when needle <> '' then public.search_like(needle) end;
  user_pattern := case
    when needle <> '' then public.search_like(lower(ltrim(btrim(query), '@')))
  end;

  return query
  select p.id, p.display_name, p.username, p.avatar_url
  from public.profiles p
  where p.deleted_at is null
    and p.id <> auth.uid()
    and (
      pattern is null
      or public.search_norm(p.display_name) like pattern
      or lower(p.username) like user_pattern
    )
    and (
      after_id is null
      or (coalesce(p.display_name, ''), p.id) > (coalesce(after_name, ''), after_id)
    )
  order by coalesce(p.display_name, ''), p.id
  limit lim;
end;
$$;

revoke execute on function public.search_people(text, text, uuid, int) from public, anon;
grant execute on function public.search_people(text, text, uuid, int) to authenticated;
