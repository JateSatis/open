-- Формат `@имени` канала проверяет база, а не только форма.
--
-- Функция вызывается с публичным ключом в обход приложения, и без проверки
-- в общее пространство имён попадала бы любая строка. Та же функция, что в
-- 20261007100000_channels.sql, с проверкой алфавита.

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

  -- Длина и нижний регистр — продуктовые правила клиента; а вот алфавит —
  -- инвариант: пробел, «@» или похожая на латиницу кириллица в `@имени`
  -- ломают упоминания и позволяют выдать себя за другого.
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
      nullif(btrim(channel_avatar_url), ''),
      me,
      new_chat
    )
    returning id into new_channel;
  exception
    when unique_violation then
      raise exception 'Это имя уже занято' using errcode = 'OPN02';
  end;

  perform set_config('open.channel_staff', 'on', true);
  insert into public.chat_members (chat_id, user_id) values (new_chat, me);
  perform set_config('open.channel_staff', '', true);

  return jsonb_build_object('channel_id', new_channel, 'chat_id', new_chat);
end;
$$;

