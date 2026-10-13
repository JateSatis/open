-- Смена фото группы доходит до участников сразу: `set_chat_avatar` шлёт
-- каждому участнику (и мне — на другие мои устройства) `chat_changed` в
-- личный топик `user:<id>`. Клиент на это перечитывает список «Чаты» и сам
-- чат — фото меняется в строке, шапке и на «О чате» без перезапуска.
-- Посторонний, открывший группу, увидит новое фото при следующем открытии.
--
-- Тело — как в 20261018100000_group_avatar.sql, добавлена только рассылка.

/**
 * Поставить, сменить или убрать (`null` / пустая строка) аватарку группы и
 * сказать об этом участникам. Может любой участник живой группы.
 */
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
  member record;
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

  -- Фото обязано сохраниться, даже если Realtime недоступен.
  begin
    for member in
      select user_id from public.chat_members where chat_id = target_chat
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

  return clean;
end;
$$;
