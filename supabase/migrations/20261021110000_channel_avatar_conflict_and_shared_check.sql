-- По ревью страницы канала.
--
-- 1. `create_channel` ловил любой `unique_violation` как «имя занято»: с
--    уникальным индексом на фото канала (20261021100000_channel_info_page.sql)
--    повтор адреса фото тоже превращался в OPN02, и клиент показывал «Имя
--    занято» при свободном имени. Теперь OPN02 — только по индексу имени;
--    повтор фото — 22023 с понятным текстом.
-- 2. Проверка адреса фото группы — та же, что у канала: одна функция
--    `clean_own_avatar_url`, а `clean_group_avatar_url` — обёртка над ней.
--    Иначе правку проверки пришлось бы делать в двух местах.

create or replace function public.clean_group_avatar_url(url text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.clean_own_avatar_url(url, 'group-avatar')
$$;

revoke execute on function public.clean_group_avatar_url(text) from public, anon, authenticated;

create or replace function public.create_channel(
  channel_title text,
  channel_username text,
  channel_description text default null,
  channel_avatar_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean_title text := nullif(btrim(channel_title), '');
  clean_username text := nullif(btrim(channel_username), '');
  new_chat uuid;
  new_channel uuid;
  violated text;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if not exists (select 1 from public.profiles where id = me and deleted_at is null) then
    raise exception 'Профиль удалён' using errcode = '42501';
  end if;

  if clean_title is null then
    raise exception 'Укажите название канала' using errcode = '22023';
  end if;

  if clean_username is null then
    raise exception 'Укажите имя канала' using errcode = '22023';
  end if;

  if clean_username !~ '^[A-Za-z0-9_]{1,64}$' then
    raise exception 'Имя может состоять только из латиницы, цифр и _' using errcode = '22023';
  end if;

  insert into public.chats (kind, created_by)
  values ('channel_posts', me)
  returning id into new_chat;

  begin
    insert into public.channels (title, description, username, avatar_url, owner_id, posts_chat_id)
    values (
      clean_title,
      nullif(btrim(channel_description), ''),
      clean_username,
      public.clean_own_avatar_url(channel_avatar_url, 'channel-avatar'),
      me,
      new_chat
    )
    returning id into new_channel;
  exception
    when unique_violation then
      get stacked diagnostics violated = constraint_name;

      if violated = 'channels_avatar_url_key' then
        raise exception 'Это фото уже стоит у другого канала' using errcode = '22023';
      end if;

      raise exception 'Это имя уже занято' using errcode = 'OPN02';
  end;

  perform set_config('open.channel_staff', 'on', true);
  insert into public.chat_members (chat_id, user_id) values (new_chat, me);
  perform set_config('open.channel_staff', '', true);

  return jsonb_build_object('channel_id', new_channel, 'chat_id', new_chat);
end;
$$;

/**
 * То же для смены фото: повтор адреса другого канала — понятный отказ, а не
 * сырой 23505.
 */
create or replace function public.set_channel_avatar(target_channel uuid, new_avatar_url text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  previous text;
begin
  perform public.lock_managed_channel(target_channel, 'фото');

  select avatar_url into previous from public.channels where id = target_channel;

  begin
    update public.channels
    set avatar_url = public.clean_own_avatar_url(new_avatar_url, 'channel-avatar')
    where id = target_channel;
  exception
    when unique_violation then
      raise exception 'Это фото уже стоит у другого канала' using errcode = '22023';
  end;

  perform public.notify_channel_changed(target_channel);

  return previous;
end;
$$;
