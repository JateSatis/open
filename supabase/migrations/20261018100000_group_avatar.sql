-- Аватарка группы.
--
-- Своя аватарка есть только у группы: у личного диалога лицо — собеседник, у
-- чата постов — канал. Ставит, меняет и убирает её любой участник живой
-- группы (как `@имя` группы) — функцией `set_chat_avatar`; прямого UPDATE
-- колонки у клиента нет: право на колонки `chats` выдано только на `title`
-- (20260926120000_chat_invites.sql). Уже при создании группы аватарку можно
-- передать в `create_chat`.
--
-- Адрес — только публичный файл нашего бакета `media` в папке
-- `{вызывающий}/group-avatar/`, и файл обязан существовать. Аватарку группы
-- видят все, кто её открыл; без проверки участник в обход приложения поставил
-- бы любой сторонний адрес — картинку, которую потом подменят, или счётчик,
-- который узнаёт каждого смотрящего. Начало адреса — из подписанного
-- `iss` токена (`https://<проект>/auth/v1`): так база знает свой адрес, не
-- храня его в миграции.
--
-- Файл лежит в префиксе того, кто его поставил, и остаётся там после смены
-- фото другим участником и после удаления аккаунта поставившего: удалить
-- чужой файл нельзя (политика бакета), а `delete-account` папку
-- `group-avatar/` не трогает.

alter table public.chats add column avatar_url text;

alter table public.chats
  add constraint chats_avatar_group_only check (avatar_url is null or kind = 'group');

/**
 * Пустая строка — null; иначе адрес обязан быть файлом аватарки группы в
 * моём префиксе бакета `media` (см. шапку миграции). Внутренняя: клиенту не
 * выдаётся, её зовут `set_chat_avatar` и `create_chat`.
 */
create function public.clean_group_avatar_url(url text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean text := nullif(btrim(url), '');
  issuer text := current_setting('request.jwt.claims', true)::jsonb ->> 'iss';
  prefix text;
  object_path text;
begin
  if clean is null then
    return null;
  end if;

  if me is null or issuer is null or issuer !~ '/auth/v1$' then
    raise exception 'Не удалось проверить адрес фото' using errcode = '42501';
  end if;

  prefix := regexp_replace(issuer, '/auth/v1$', '') || '/storage/v1/object/public/media/';

  if left(clean, length(prefix)) <> prefix then
    raise exception 'Фото группы должно быть загружено в Open' using errcode = '22023';
  end if;

  object_path := substr(clean, length(prefix) + 1);

  if object_path !~ ('^' || me::text || '/group-avatar/[A-Za-z0-9_-]+\.jpg$') then
    raise exception 'Фото группы должно быть загружено в Open' using errcode = '22023';
  end if;

  if not exists (
    select 1 from storage.objects where bucket_id = 'media' and name = object_path
  ) then
    raise exception 'Файл фото не найден' using errcode = '22023';
  end if;

  return clean;
end;
$$;

revoke execute on function public.clean_group_avatar_url(text) from public, anon, authenticated;

/**
 * Поставить, сменить или убрать (`null` / пустая строка) аватарку группы.
 * Может любой участник живой группы; у личного диалога и чата постов своей
 * аватарки нет. Отдаёт новый адрес.
 */
create function public.set_chat_avatar(target_chat uuid, new_avatar_url text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean text;
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
    raise exception 'Фото бывает только у группы' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.chat_members where chat_id = target_chat and user_id = me
  ) then
    raise exception 'Менять фото группы может только участник' using errcode = '42501';
  end if;

  clean := public.clean_group_avatar_url(new_avatar_url);

  update public.chats set avatar_url = clean where id = target_chat;

  return clean;
end;
$$;

revoke execute on function public.set_chat_avatar(uuid, text) from public, anon;
grant execute on function public.set_chat_avatar(uuid, text) to authenticated;

-- =============================================================================
-- create_chat: аватарка группы сразу при создании
-- =============================================================================
--
-- Сигнатура меняется — функция пересоздаётся с теми же правами. У диалога
-- аватарка игнорируется: своей у него нет. При встречной заявке
-- (`incoming_invite`) чат уже существует — аватарка тоже не ставится.

drop function public.create_chat(uuid[], text);

create function public.create_chat(
  invitee_ids uuid[],
  chat_title text default null,
  chat_avatar_url text default null
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
  new_chat uuid;
  inviter_name text;
  clean_title text := nullif(btrim(chat_title), '');
  clean_avatar text;
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

  if cardinality(invitees) > 1 then
    clean_avatar := public.clean_group_avatar_url(chat_avatar_url);
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

  insert into public.chats (kind, title, avatar_url, created_by, founding_member_ids)
  values (
    case when cardinality(invitees) = 1 then 'direct' else 'group' end,
    clean_title,
    clean_avatar,
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

revoke execute on function public.create_chat(uuid[], text, text) from public, anon;
grant execute on function public.create_chat(uuid[], text, text) to authenticated;
