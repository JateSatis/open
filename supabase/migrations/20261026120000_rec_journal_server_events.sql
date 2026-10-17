-- Рекомендации, этап 1: серверные события журнала.
--
-- Всё, что человек делает и что уже пишется в базу, попадает в журнал
-- триггерами из своих таблиц — из любого места приложения, без клиента и
-- без возможности подделать отдельно: реакции, комментарии, сообщения,
-- пересылки, подписки, засчитанные просмотры сообщений, состав чатов,
-- отказ от приглашения, скрытие.
--
-- Привязка к показу — не здесь, а в свёртке: по человеку, объекту и времени
-- внутри показа плюс окно опоздания. Поэтому событие несёт ссылки, по
-- которым свёртка найдёт поп (`pop_id`) или канал (`channel_id`).
--
-- Время серверного события — время записи (`event_ts = server_ts`).
--
-- Удаление аккаунта каскадом удаляет подписки и участие в чатах — их
-- триггеры не пишут событие человека, которого уже нет: журнал не ломает
-- удаление.

/** Серверное событие журнала от имени `actor`. Человека нет — молчит. */
create function public.rec_log(actor uuid, event_kind text, target_type text, target_id uuid, info jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.rec_events (user_id, origin, kind, subject_type, subject_id, data)
  select actor, 'server', event_kind, target_type, target_id, coalesce(jsonb_strip_nulls(info), '{}'::jsonb)
  where actor is not null
    and exists (select 1 from public.profiles where id = actor)
$$;

revoke execute on function public.rec_log(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

-- =============================================================================
-- Реакции: поставлена, заменена, снята
-- =============================================================================

create function public.rec_on_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  was_active boolean := tg_op = 'UPDATE' and old.deleted_at is null;
  is_active boolean := new.deleted_at is null;
  info jsonb;
  held_ms bigint;
begin
  if new.user_id is null or (was_active and is_active and old.emoji = new.emoji) then
    return null;
  end if;

  if not was_active and not is_active then
    return null;
  end if;

  -- Где цель живёт: поп комментария, сообщение фрагмента — для свёртки.
  info := jsonb_build_object(
    'chat_id', new.chat_id,
    'audience', new.audience,
    'pop_id', case
      when new.target_type = 'pop' then new.target_id
      when new.target_type = 'comment' then (select c.pop_id from public.comments c where c.id = new.target_id)
    end,
    'message_id', case
      when new.target_type = 'comment' then (select c.message_id from public.comments c where c.id = new.target_id)
      when new.target_type = 'fragment' then (select f.message_id from public.message_fragments f where f.id = new.target_id)
    end,
    'channel_id', case
      when new.target_type = 'pop' then (select p.channel_id from public.pops p where p.id = new.target_id)
    end
  );

  if is_active then
    perform public.rec_log(new.user_id, 'reaction_set', new.target_type, new.target_id, info || jsonb_build_object(
      'emoji', new.emoji,
      'valence', (select e.valence from public.reaction_emojis e where e.emoji = new.emoji),
      'previous', case when was_active then old.emoji end
    ));
  else
    held_ms := (extract(epoch from (now() - old.updated_at)) * 1000)::bigint;

    perform public.rec_log(new.user_id, 'reaction_removed', new.target_type, new.target_id, info || jsonb_build_object(
      'emoji', old.emoji,
      'held_ms', held_ms,
      'quick', held_ms < coalesce((public.rec_settings() ->> 'quickUndoMs')::int, 5000)
    ));
  end if;

  return null;
end;
$$;

revoke execute on function public.rec_on_reaction() from public, anon, authenticated;

create trigger reactions_rec_journal
  after insert or update of emoji, deleted_at on public.reactions
  for each row execute function public.rec_on_reaction();

-- =============================================================================
-- Комментарии
-- =============================================================================
--
-- В конце транзакции: вложения и цитаты комментария дописываются после его
-- строки той же функцией отправки.

create function public.rec_on_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.author_id is null then
    return null;
  end if;

  perform public.rec_log(
    new.author_id,
    'comment_sent',
    case when new.pop_id is not null then 'pop' else 'message' end,
    coalesce(new.pop_id, new.message_id),
    jsonb_build_object(
      'comment_id', new.id,
      'kind', new.kind,
      'length', char_length(coalesce(new.text, '')),
      'voice_ms', (
        select a.duration_ms from public.comment_attachments a
        where a.comment_id = new.id and a.comment_kind = 'voice'
        limit 1
      ),
      'media', (select count(*) from public.comment_attachments a where a.comment_id = new.id and a.comment_kind = 'media'),
      'reply', new.thread_root_id is not null,
      'quotes', (select count(*) from public.comment_replies r where r.comment_id = new.id),
      'fragment_id', new.fragment_id,
      'audience', new.audience,
      'chat_id', new.chat_id,
      'pop_id', new.pop_id,
      'channel_id', case when new.pop_id is not null then (select p.channel_id from public.pops p where p.id = new.pop_id) end
    )
  );

  return null;
end;
$$;

revoke execute on function public.rec_on_comment() from public, anon, authenticated;

create constraint trigger comments_rec_journal
  after insert on public.comments
  deferrable initially deferred
  for each row execute function public.rec_on_comment();

-- =============================================================================
-- Сообщения и пересланные комментарии
-- =============================================================================
--
-- Островок пересылки — не сообщение: его позиции пишет триггер
-- `forward_items` ниже, по оригиналу. Системные строки — не действие
-- человека (состав чата — из `chat_members`).

create function public.rec_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chat_kind text := (select c.kind from public.chats c where c.id = new.chat_id);
begin
  if new.author_id is null or new.kind in ('system', 'forward') then
    return null;
  end if;

  if new.kind = 'comment_forward' then
    perform public.rec_log(new.author_id, 'forward_sent', 'comment', new.forwarded_comment_id, jsonb_build_object(
      'forward_id', new.id,
      'to_chat_id', new.chat_id,
      'to_chat_kind', chat_kind,
      'pop_id', (select c.pop_id from public.comments c where c.id = new.forwarded_comment_id)
    ));

    return null;
  end if;

  perform public.rec_log(new.author_id, 'message_sent', 'message', new.id, jsonb_build_object(
    'chat_id', new.chat_id,
    'chat_kind', chat_kind,
    'kind', new.kind,
    'length', char_length(coalesce(new.text, '')),
    'photos', (select count(*) from public.attachments a where a.message_id = new.id and a.mime_type like 'image/%'),
    'videos', (select count(*) from public.attachments a where a.message_id = new.id and a.mime_type like 'video/%'),
    'voice_ms', (
      select a.duration_ms from public.attachments a
      where a.message_id = new.id and new.kind in ('voice', 'video_note')
      limit 1
    ),
    'pop_id', (select a.pop_id from public.attachments a where a.message_id = new.id and a.pop_id is not null limit 1),
    'quotes', (select count(*) from public.message_replies r where r.message_id = new.id),
    'stream', new.stream_id is not null
  ));

  return null;
end;
$$;

revoke execute on function public.rec_on_message() from public, anon, authenticated;

create constraint trigger messages_rec_journal
  after insert on public.messages
  deferrable initially deferred
  for each row execute function public.rec_on_message();

-- Позиция островка — пересылка оригинала: кто, куда, и поп, если это пост с попом.
create function public.rec_on_forward_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  island public.messages;
  original public.messages;
begin
  select * into island from public.messages where id = new.forward_id;
  select * into original from public.messages where id = new.message_id;

  perform public.rec_log(island.author_id, 'forward_sent', 'message', new.message_id, jsonb_build_object(
    'forward_id', new.forward_id,
    'to_chat_id', new.chat_id,
    'to_chat_kind', (select c.kind from public.chats c where c.id = new.chat_id),
    'source_chat_id', original.chat_id,
    'position', new.position,
    'pop_id', (select a.pop_id from public.attachments a where a.message_id = new.message_id and a.pop_id is not null limit 1),
    'channel_id', (select ch.id from public.channels ch where ch.posts_chat_id = original.chat_id)
  ));

  return null;
end;
$$;

revoke execute on function public.rec_on_forward_item() from public, anon, authenticated;

create trigger forward_items_rec_journal
  after insert on public.forward_items
  for each row execute function public.rec_on_forward_item();

-- =============================================================================
-- Подписки
-- =============================================================================
--
-- Отписка удаляет строку физически — событие пишется из старой строки.

create function public.rec_on_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.rec_log(
      new.subscriber_id, 'subscribed',
      case when new.channel_id is not null then 'channel' else 'chat' end,
      coalesce(new.channel_id, new.chat_id),
      jsonb_build_object('in_chats', new.in_chats, 'notify', new.notify, 'channel_id', new.channel_id)
    );
  elsif tg_op = 'DELETE' then
    perform public.rec_log(
      old.subscriber_id, 'unsubscribed',
      case when old.channel_id is not null then 'channel' else 'chat' end,
      coalesce(old.channel_id, old.chat_id),
      jsonb_build_object(
        'held_ms', (extract(epoch from (now() - old.created_at)) * 1000)::bigint,
        'channel_id', old.channel_id
      )
    );
  elsif new.in_chats is distinct from old.in_chats or new.notify is distinct from old.notify then
    perform public.rec_log(
      new.subscriber_id, 'subscription_changed',
      case when new.channel_id is not null then 'channel' else 'chat' end,
      coalesce(new.channel_id, new.chat_id),
      jsonb_build_object('in_chats', new.in_chats, 'notify', new.notify, 'channel_id', new.channel_id)
    );
  end if;

  return null;
end;
$$;

revoke execute on function public.rec_on_subscription() from public, anon, authenticated;

create trigger subscriptions_rec_journal
  after insert or update of in_chats, notify or delete on public.subscriptions
  for each row execute function public.rec_on_subscription();

-- =============================================================================
-- Засчитанные просмотры сообщений
-- =============================================================================
--
-- Зеркало `record_message_views`: строка появилась — первый просмотр,
-- обновилась `counted_at` — засчитан повторный.

create function public.rec_on_message_view()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.rec_log(new.viewer_id, 'message_viewed', 'message', new.message_id, jsonb_build_object(
    'first', tg_op = 'INSERT',
    'screen_session_id', new.session_id
  ));

  return null;
end;
$$;

revoke execute on function public.rec_on_message_view() from public, anon, authenticated;

create trigger message_views_rec_journal
  after insert or update of counted_at on public.message_views
  for each row execute function public.rec_on_message_view();

-- =============================================================================
-- Состав чатов и приглашения
-- =============================================================================

create function public.rec_on_chat_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chat_kind text := (select c.kind from public.chats c where c.id = coalesce(new.chat_id, old.chat_id));
begin
  if tg_op = 'INSERT' then
    perform public.rec_log(new.user_id, 'chat_joined', 'chat', new.chat_id, jsonb_build_object(
      'chat_kind', chat_kind,
      'added_by', case when auth.uid() is distinct from new.user_id then auth.uid() end
    ));
  else
    perform public.rec_log(old.user_id, 'chat_left', 'chat', old.chat_id, jsonb_build_object(
      'chat_kind', chat_kind,
      'removed_by', case when auth.uid() is distinct from old.user_id then auth.uid() end
    ));
  end if;

  return null;
end;
$$;

revoke execute on function public.rec_on_chat_member() from public, anon, authenticated;

create trigger chat_members_rec_journal
  after insert or delete on public.chat_members
  for each row execute function public.rec_on_chat_member();

create function public.rec_on_chat_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'declined' and old.status is distinct from 'declined' then
    perform public.rec_log(new.invitee_id, 'invite_declined', 'chat', new.chat_id, jsonb_build_object(
      'inviter_id', new.inviter_id
    ));
  end if;

  return null;
end;
$$;

revoke execute on function public.rec_on_chat_invite() from public, anon, authenticated;

create trigger chat_invites_rec_journal
  after update of status on public.chat_invites
  for each row execute function public.rec_on_chat_invite();

-- =============================================================================
-- Скрытие
-- =============================================================================

create function public.rec_on_hidden_pop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.rec_hidden_pops := case when tg_op = 'INSERT' then new else old end;
begin
  perform public.rec_log(
    r.user_id,
    case when tg_op = 'INSERT' then 'pop_not_interested' else 'pop_not_interested_cleared' end,
    'pop',
    r.pop_id,
    jsonb_build_object('pop_id', r.pop_id, 'channel_id', (select p.channel_id from public.pops p where p.id = r.pop_id))
  );

  return null;
end;
$$;

revoke execute on function public.rec_on_hidden_pop() from public, anon, authenticated;

create trigger rec_hidden_pops_journal
  after insert or delete on public.rec_hidden_pops
  for each row execute function public.rec_on_hidden_pop();

create function public.rec_on_hidden_channel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.rec_hidden_channels := case when tg_op = 'INSERT' then new else old end;
begin
  perform public.rec_log(
    r.user_id,
    case when tg_op = 'INSERT' then 'channel_hidden' else 'channel_unhidden' end,
    'channel',
    r.channel_id,
    jsonb_build_object(
      'channel_id', r.channel_id,
      'pop_id', r.from_pop_id,
      'via', case when tg_op = 'DELETE' then coalesce(nullif(current_setting('rec.unhide_via', true), ''), 'menu') end
    )
  );

  return null;
end;
$$;

revoke execute on function public.rec_on_hidden_channel() from public, anon, authenticated;

create trigger rec_hidden_channels_journal
  after insert or delete on public.rec_hidden_channels
  for each row execute function public.rec_on_hidden_channel();

-- Та же функция, что в 20261026100000_rec_journal_storage.sql, плюс метка,
-- что скрытие сняла подписка, а не пункт меню.
create or replace function public.rec_unhide_on_subscribe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.channel_id is not null then
    perform set_config('rec.unhide_via', 'subscribe', true);

    delete from public.rec_hidden_channels
    where user_id = new.subscriber_id and channel_id = new.channel_id;

    perform set_config('rec.unhide_via', '', true);
  end if;

  return null;
end;
$$;
