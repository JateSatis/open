-- Рассылка о новом попе смотрит на поп, каким он стал к фиксации.
--
-- Триггер отложенный, а `new` в нём — строка на момент вставки: поп, удалённый
-- позже в той же транзакции, всё равно разошёлся бы читателям «Новым попсом».
-- Та же функция, что в 20261013100000_channel_subscriptions.sql, с перечитанной
-- строкой.

create or replace function public.broadcast_new_pop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_pop public.pops;
  ch public.channels;
  reader record;
  payload jsonb;
begin
  select * into current_pop from public.pops where id = new.id and deleted_at is null;

  if current_pop.id is null
    or exists (select 1 from public.attachments where pop_id = current_pop.id) then
    return null;
  end if;

  select * into ch from public.channels where id = current_pop.channel_id;

  payload := jsonb_build_object(
    'pop_id', current_pop.id,
    'channel_id', ch.id,
    'chat_id', ch.posts_chat_id,
    'channel_title', ch.title,
    'channel_avatar_url', ch.avatar_url,
    'created_at', current_pop.created_at
  );

  begin
    for reader in
      select subscriber_id, notify from public.subscriptions
      where channel_id = current_pop.channel_id and in_chats
    loop
      perform realtime.send(
        payload || jsonb_build_object('notify', reader.notify),
        'new_pop',
        'user:' || reader.subscriber_id::text,
        true
      );
    end loop;
  exception
    when others then null;
  end;

  return null;
end;
$$;

revoke execute on function public.broadcast_new_pop() from public, anon, authenticated;
