-- Момент, когда подписка попала в «Чаты». Список «Чатов» ставит чат по
-- позднему из двух: последняя активность и мой момент входа — для участника
-- это `chat_members.joined_at`, для подписчика — этот. Только что подписался
-- на канал со старым последним постом — он наверху.
--
-- Не `created_at`: на канал подписываются и без «Чатов» (из попса), а в чаты
-- добавляют позже. Ставит колонку триггер, а не функции: `in_chats` меняют
-- несколько функций, и любая новая не должна об этом помнить.

alter table public.subscriptions add column in_chats_at timestamptz;

-- Подписки, которые уже в «Чатах», — с момента подписки: точнее не узнать.
update public.subscriptions set in_chats_at = created_at where in_chats;

alter table public.subscriptions
  add constraint subscriptions_in_chats_at check ((in_chats_at is not null) = in_chats);

create function public.stamp_subscription_in_chats()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not new.in_chats then
    new.in_chats_at := null;
  elsif tg_op = 'INSERT' or not old.in_chats then
    new.in_chats_at := now();
  else
    -- Уже в чатах: момент входа не переписывается ни повтором, ни клиентом.
    new.in_chats_at := old.in_chats_at;
  end if;

  return new;
end;
$$;

revoke execute on function public.stamp_subscription_in_chats() from public, anon, authenticated;

create trigger subscriptions_stamp_in_chats
  before insert or update of in_chats, in_chats_at on public.subscriptions
  for each row execute function public.stamp_subscription_in_chats();

-- Тип результата меняется — функцию пересоздаём, права заново. Тело — как в
-- 20261014100000_chat_subscriptions.sql, плюс `in_chats_at`.
drop function public.my_subscriptions(uuid);

/**
 * Мои подписки с непрочитанным. Без аргумента — те, что в «Чатах»: каналы
 * читателя и все подписки на чаты. С `target_chat` — подписка на этот чат
 * или на канал этого чата постов, в чатах она или нет (экран переписки).
 * `channel_id` у подписки на чат — null, попсов у чата нет. `in_chats_at` —
 * когда подписка попала в «Чаты» (у не попавшей — null).
 */
create function public.my_subscriptions(target_chat uuid default null)
returns table (
  channel_id uuid,
  chat_id uuid,
  in_chats boolean,
  notify boolean,
  unread_posts int,
  unread_pops int,
  in_chats_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.channel_id,
    ch.posts_chat_id,
    s.in_chats,
    s.notify,
    public.subscription_unread_messages(ch.posts_chat_id, s.messages_read_at, s.subscriber_id),
    public.subscription_unread_pops(ch.id, s.pops_read_at, s.subscriber_id),
    s.in_chats_at
  from public.subscriptions s
  join public.channels ch on ch.id = s.channel_id and ch.deleted_at is null
  where s.subscriber_id = auth.uid()
    and case when target_chat is null then s.in_chats else ch.posts_chat_id = target_chat end
  union all
  select
    null::uuid,
    s.chat_id,
    s.in_chats,
    s.notify,
    public.subscription_unread_messages(s.chat_id, s.messages_read_at, s.subscriber_id),
    0,
    s.in_chats_at
  from public.subscriptions s
  join public.chats c on c.id = s.chat_id and c.deleted_at is null
  where s.subscriber_id = auth.uid()
    and (target_chat is null or s.chat_id = target_chat)
$$;

revoke execute on function public.my_subscriptions(uuid) from public, anon;
grant execute on function public.my_subscriptions(uuid) to authenticated;
