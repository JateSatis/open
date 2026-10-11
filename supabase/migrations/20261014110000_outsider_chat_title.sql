-- Название переписки в карточке подписчика — по тем же правилам, что у
-- клиента (`chatTitle` в chatDisplay.ts): заданное название как есть; у
-- диалога — двое, участники в порядке вступления, за ними ещё не принявшие
-- заявку; группа без названия — «Групповой чат». В 20261014100000 база
-- собирала имя иначе (только участники, группа — перечнем), и карточка
-- называла чат не так, как строка в «Чатах».

/** Название чужого диалога или группы глазами постороннего. Только для рассылки. */
create function public.outsider_chat_title(target_chat uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(c.title, ''),
    case when c.kind = 'direct' then (
      select string_agg(people.name, ' и ' order by people.rank, people.at)
      from (
        select * from (
          select coalesce(p.display_name, 'Без имени') as name, 0 as rank, cm.joined_at as at
          from public.chat_members cm
          join public.profiles p on p.id = cm.user_id
          where cm.chat_id = c.id
          union all
          select coalesce(p.display_name, 'Без имени'), 1, i.created_at
          from public.chat_invites i
          join public.profiles p on p.id = i.invitee_id
          where i.chat_id = c.id and i.status = 'pending'
        ) everyone
        order by rank, at
        limit 2
      ) people
    ) end,
    case when c.kind = 'group' then 'Групповой чат' else 'Диалог' end
  )
  from public.chats c
  where c.id = target_chat
$$;

revoke execute on function public.outsider_chat_title(uuid) from public, anon, authenticated;

create or replace function public.broadcast_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
  member record;
  author_name text;
  preview_text text;
  posts_channel public.channels;
  outsider_title text;
begin
  preview_text := public.message_preview_text(new);

  update public.chats
  set
    last_message_at = new.created_at,
    last_message_text = preview_text,
    last_message_author_id = new.author_id
  where id = new.chat_id;

  select display_name into author_name from public.profiles where id = new.author_id;
  select * into posts_channel from public.channels where posts_chat_id = new.chat_id;

  payload := jsonb_build_object(
    'message_id', new.id,
    'chat_id', new.chat_id,
    'author_id', new.author_id,
    'author_name', author_name,
    'kind', new.kind,
    'text', preview_text,
    'created_at', new.created_at
  );

  -- Пост подписан каналом, а не человеком, который его опубликовал.
  if posts_channel.id is not null then
    payload := payload || jsonb_build_object(
      'channel_id', posts_channel.id,
      'channel_title', posts_channel.title,
      'channel_avatar_url', posts_channel.avatar_url
    );
  end if;

  begin
    perform realtime.send(payload, 'new_message', 'chat:' || new.chat_id::text, true);

    for member in
      select user_id from public.chat_members
      where chat_id = new.chat_id and user_id is distinct from new.author_id
    loop
      perform realtime.send(payload, 'new_message', 'user:' || member.user_id::text, true);
    end loop;

    if posts_channel.id is not null then
      for member in
        select subscriber_id, notify from public.subscriptions
        where channel_id = posts_channel.id and in_chats
          and subscriber_id is distinct from new.author_id
      loop
        perform realtime.send(
          payload || jsonb_build_object('notify', member.notify),
          'new_message',
          'user:' || member.subscriber_id::text,
          true
        );
      end loop;
    elsif exists (select 1 from public.subscriptions where chat_id = new.chat_id) then
      outsider_title := public.outsider_chat_title(new.chat_id);

      for member in
        select subscriber_id, notify from public.subscriptions
        where chat_id = new.chat_id
      loop
        perform realtime.send(
          payload || jsonb_build_object('notify', member.notify, 'chat_title', outsider_title),
          'new_message',
          'user:' || member.subscriber_id::text,
          true
        );
      end loop;
    end if;

    for member in
      select invitee_id as user_id from public.chat_invites
      where chat_id = new.chat_id and status = 'pending' and invitee_id is not null
    loop
      perform realtime.send(
        jsonb_build_object('chat_id', new.chat_id),
        'invite_activity',
        'user:' || member.user_id::text,
        true
      );
    end loop;
  exception
    when others then null;
  end;

  return new;
end;
$$;
