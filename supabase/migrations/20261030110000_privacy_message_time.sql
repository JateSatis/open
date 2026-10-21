-- Приватность, этап 2: «Кто видит время сообщений и прочтение»
-- (`message_activity_metadata_visibility`).
--
-- Скрывается время всего диалога, а не только сообщений владельца: если в
-- личке или группе участвует человек, чья настройка закрывает время от
-- зрителя, этот зритель не получает ни времени отправки, ни времени правки,
-- ни отметок прочтения ни у одного сообщения этого чата — иначе время
-- восстанавливалось бы по соседним репликам. Участников это тоже касается.
-- Чат постов канала не скрывается: это не диалог, а публикация канала.
--
-- Реальные метки в базе не меняются: на них стоят сортировка, модерация,
-- проверки «в той же транзакции». Закрыто только чтение:
--
--   messages      — время (`created_at`, `edited_at`, `read_at`) и сырые
--                   счётчики просмотров клиенту не читаются (права на
--                   колонки). Сообщения клиент читает из представления
--                   `message_rows`: то же самое, но время — null, если оно
--                   скрыто от смотрящего, правка — признаком `edited` и
--                   номером `edit_mark` без времени, курсор — `seq`.
--   chat_members  — `last_read_at` и `joined_at` закрыты; участники с
--                   отметками — функцией `chat_people`.
--   chats         — `last_message_at` больше не колонка: вычисляемое поле с
--                   той же проверкой, порядок «Чатов» и непрочитанное —
--                   `my_chat_list`.
--   attachments, message_replies, forward_items — их `created_at` совпадает
--                   с временем сообщения и тоже закрыт.
--
-- Почему представление, а не вычисляемые поля над таблицей: PostgREST
-- передаёт в вычисляемое поле строку целиком, а такая ссылка требует права
-- на все колонки таблицы — после закрытия колонок времени `my_reaction`,
-- `reactors` и прочие поля `messages` перестали бы работать. У
-- представления свои вычисляемые поля (ниже).
--
-- Проверка стоит на горячем пути, поэтому у чата есть денормализованный
-- признак `time_restricted` — «есть участник, чья настройка не «Все»». Пока
-- его нет, проверка — одно чтение строки чата; `privacy_allows` зовётся
-- только у чатов с признаком.
--
-- Просмотры: в личке на двоих +1 к просмотрам и есть «прочитано». Зритель,
-- от которого время чата скрыто, видит число без просмотров участников
-- (`member_views_count` вычитается), а сигнал о просмотре участником в топик
-- скрытого чата не уходит.

-- =============================================================================
-- Признак чата
-- =============================================================================

alter table public.chats add column time_restricted boolean not null default false;

/** Есть ли в личке или группе участник, чья настройка времени не «Все». */
create function public.chat_time_restricted_now(p_chat uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select c.kind in ('direct', 'group') and exists (
      select 1
      from public.chat_members cm
      join public.privacy_settings s on s.user_id = cm.user_id
      where cm.chat_id = c.id
        and s.message_activity_metadata_visibility <> 'everyone'
    )
    from public.chats c
    where c.id = p_chat
  ), false)
$$;

create function public.refresh_chat_time_restricted(p_chat uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.chats
  set time_restricted = public.chat_time_restricted_now(p_chat)
  where id = p_chat
    and time_restricted is distinct from public.chat_time_restricted_now(p_chat)
$$;

create function public.on_chat_member_time_restriction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_chat_time_restricted(coalesce(new.chat_id, old.chat_id));

  return null;
end;
$$;

create trigger chat_members_time_restriction
  after insert or delete on public.chat_members
  for each row execute function public.on_chat_member_time_restriction();

/**
 * Смена настройки времени: признак у всех чатов владельца и сигнал
 * `time_visibility_changed` в их топики — открытые экраны перечитывают
 * сообщения, время пропадает (или появляется) без перезапуска.
 */
create function public.on_privacy_time_setting_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chat record;
begin
  if new.message_activity_metadata_visibility is not distinct from old.message_activity_metadata_visibility then
    return null;
  end if;

  for chat in
    select cm.chat_id from public.chat_members cm where cm.user_id = new.user_id
  loop
    perform public.refresh_chat_time_restricted(chat.chat_id);

    begin
      perform realtime.send(
        jsonb_build_object('chat_id', chat.chat_id),
        'time_visibility_changed',
        'chat:' || chat.chat_id::text,
        true
      );
    exception
      when others then null;
    end;
  end loop;

  return null;
end;
$$;

create trigger privacy_settings_time_restriction
  after update on public.privacy_settings
  for each row execute function public.on_privacy_time_setting_changed();

update public.chats c
set time_restricted = public.chat_time_restricted_now(c.id)
where public.chat_time_restricted_now(c.id);

-- =============================================================================
-- Видно ли смотрящему время чата
-- =============================================================================

/**
 * Время чата видно смотрящему (`auth.uid()`): признака нет — да; иначе —
 * только если каждый другой участник пускает его своей настройкой. Сам себя
 * никто не прячет, но чужая настройка прячет и мои сообщения: время чата
 * общее.
 */
create function public.chat_time_visible(p_chat uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  viewer uuid := auth.uid();
  restricted boolean;
begin
  select c.time_restricted into restricted from public.chats c where c.id = p_chat;

  if not coalesce(restricted, false) then
    return true;
  end if;

  if viewer is null then
    return false;
  end if;

  return not exists (
    select 1
    from public.chat_members cm
    where cm.chat_id = p_chat
      and cm.user_id <> viewer
      and not public.privacy_allows('message_activity_metadata_visibility', cm.user_id, viewer)
  );
end;
$$;

-- =============================================================================
-- Просмотры участников — отдельно
-- =============================================================================

alter table public.messages
  add column member_views_count int not null default 0,
  add column member_unique_views_count int not null default 0;

-- Повторы прежних просмотров не восстановить — участник считается одним.
update public.messages m
set member_unique_views_count = seen.n,
    member_views_count = least(seen.n, m.views_count)
from (
  select v.message_id, count(*)::int as n
  from public.message_views v
  join public.messages mm on mm.id = v.message_id
  join public.chat_members cm on cm.chat_id = mm.chat_id and cm.user_id = v.viewer_id
  group by v.message_id
) seen
where seen.message_id = m.id;

drop policy "messages can only be sent by chat members" on public.messages;

create policy "messages can only be sent by chat members"
  on public.messages for insert
  to authenticated
  with check (
    auth.uid() = author_id
    and auth.uid() in (
      select user_id from public.chat_members where chat_id = messages.chat_id
    )
    and kind in ('text', 'media', 'voice')
    and forwarded_comment_id is null
    and source_chat_id is null
    and stream_id is null
    and system_event is null
    and deleted_at is null
    and comments_count = 0
    and reactions_count = 0
    and member_reactions = '{}'::jsonb
    and visitor_reactions = '{}'::jsonb
    and views_count = 0
    and unique_views_count = 0
    and member_views_count = 0
    and member_unique_views_count = 0
    and read_at is null
  );

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
-- Сообщения глазами смотрящего
-- =============================================================================
--
-- Права владельца представления: RLS таблицы оно обходит, поэтому условие
-- SELECT-политики `messages` (живые) повторено здесь. Новое условие
-- видимости сообщений (блокировки, этап 3) добавляется в оба места.

/** Сколько раз сообщение правили — меняется с каждой правкой, времени не раскрывает. */
create function public.message_edit_count(p_message uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.message_revisions where message_id = p_message
$$;

create view public.message_rows as
select
  m.id,
  m.chat_id,
  m.author_id,
  m.kind,
  m.text,
  m.seq,
  case when t.visible then m.created_at end as created_at,
  case when t.visible then m.edited_at end as edited_at,
  m.edited_at is not null as edited,
  case when m.edited_at is not null then public.message_edit_count(m.id) end as edit_mark,
  case when t.visible then m.read_at end as read_at,
  m.deleted_at,
  m.member_reactions,
  m.visitor_reactions,
  m.reactions_count,
  m.comments_count,
  m.clusters_count,
  m.fragments_count,
  case when t.visible then m.views_count
    else greatest(m.views_count - m.member_views_count, 0) end as views_count,
  case when t.visible then m.unique_views_count
    else greatest(m.unique_views_count - m.member_unique_views_count, 0) end as unique_views_count,
  m.stream_id,
  m.system_event,
  m.system_user_id,
  m.source_chat_id,
  m.forwarded_comment_id,
  t.visible as time_visible
from public.messages m
cross join lateral (select public.chat_time_visible(m.chat_id) as visible) t
where m.deleted_at is null;

revoke all on public.message_rows from anon, authenticated;
grant select on public.message_rows to authenticated;

-- Вычисляемые связи сообщения — те же, что у `messages`.

create function public.my_reaction(public.message_rows)
returns setof public.reactions
language sql
stable
rows 1
set search_path = public
as $$
  select *
  from public.reactions r
  where r.target_type = 'message'
    and r.target_id = $1.id
    and r.user_id = auth.uid()
    and r.deleted_at is null
$$;

create function public.reactors(public.message_rows)
returns setof public.reactions
language sql
stable
rows 40
set search_path = public
as $$
  select r.*
  from jsonb_each_text($1.member_reactions) e
  cross join lateral (
    select *
    from public.reactions x
    where x.target_type = 'message'
      and x.target_id = $1.id
      and x.emoji = e.key
      and x.audience = 'member'
      and x.deleted_at is null
    order by x.updated_at
    limit 2
  ) r
  where e.value::int <= 2
$$;

create function public.my_stream_participation(public.message_rows)
returns setof public.stream_participants
language sql
stable
rows 1
set search_path = public
as $$
  select *
  from public.stream_participants p
  where $1.stream_id is not null
    and p.stream_id = $1.stream_id
    and p.user_id = auth.uid()
    and p.deleted_at is null
$$;

revoke execute on function public.my_reaction(public.message_rows) from public, anon;
revoke execute on function public.reactors(public.message_rows) from public, anon;
revoke execute on function public.my_stream_participation(public.message_rows) from public, anon;
grant execute on function public.my_reaction(public.message_rows) to authenticated;
grant execute on function public.reactors(public.message_rows) to authenticated;
grant execute on function public.my_stream_participation(public.message_rows) to authenticated;

-- =============================================================================
-- Закрытые колонки
-- =============================================================================
--
-- Новая колонка этих таблиц клиенту не видна, пока её не добавят в grant
-- ниже (или в представление).

revoke select on public.messages from anon, authenticated;
grant select (
  id, chat_id, author_id, kind, text, seq, deleted_at, member_reactions, visitor_reactions,
  reactions_count, comments_count, clusters_count, fragments_count, stream_id, system_event,
  system_user_id, source_chat_id, forwarded_comment_id
) on public.messages to authenticated;

revoke select on public.chat_members from anon, authenticated;
grant select (id, chat_id, user_id) on public.chat_members to authenticated;

revoke select on public.attachments from anon, authenticated;
grant select (
  id, message_id, message_kind, url, mime_type, width, height, duration_ms, size_bytes,
  position, poster_url, waveform, pop_id
) on public.attachments to authenticated;

revoke select on public.message_replies from anon, authenticated;
grant select (id, chat_id, message_id, quoted_id, position, quoted_forward_id)
  on public.message_replies to authenticated;

revoke select on public.forward_items from anon, authenticated;
grant select (id, chat_id, forward_id, forward_kind, message_id, position, deleted_at)
  on public.forward_items to authenticated;

-- «В той же транзакции» — проверки политик по времени сообщения. Политика
-- выполняется с правами клиента, а время ему больше не читается: проверка —
-- функцией с правами владельца.

/** Моё сообщение, созданное в этой транзакции (и, если задан, в этом чате). */
create function public.message_sent_now(p_message uuid, p_chat uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.messages m
    where m.id = p_message
      and (p_chat is null or m.chat_id = p_chat)
      and m.author_id = auth.uid()
      and m.created_at = now()
  )
$$;

revoke execute on function public.message_sent_now(uuid, uuid) from public, anon;
grant execute on function public.message_sent_now(uuid, uuid) to authenticated;

drop policy "attachments are added by the author when sending" on public.attachments;

create policy "attachments are added by the author when sending"
  on public.attachments for insert
  to authenticated
  with check (pop_id is null and public.message_sent_now(message_id));

drop policy "message_replies are attached by the author when sending" on public.message_replies;

create policy "message_replies are attached by the author when sending"
  on public.message_replies for insert
  to authenticated
  with check (
    public.message_sent_now(message_id, chat_id)
    and exists (select 1 from public.messages q where q.id = message_replies.quoted_id)
  );

-- =============================================================================
-- Время последнего сообщения чата
-- =============================================================================
--
-- Колонка уходит: она открыта всем, как и весь `chats`. Последнее сообщение
-- берётся по номеру из индекса (`messages_chat_seq_idx`); превью и автор
-- последнего остаются денормализованными — времени в них нет.

alter table public.chats drop column last_message_at;

/** Время последнего живого сообщения — null, если время чата скрыто от смотрящего. */
create function public.last_message_at(public.chats)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select m.created_at
  from public.messages m
  where m.chat_id = $1.id and m.deleted_at is null and public.chat_time_visible($1.id)
  order by m.seq desc
  limit 1
$$;

revoke execute on function public.last_message_at(public.chats) from public, anon;
grant execute on function public.last_message_at(public.chats) to authenticated;

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
    last_message_text = preview_text,
    last_message_author_id = new.author_id
  where id = new.chat_id;

  select display_name into author_name from public.profiles where id = new.author_id;
  select * into posts_channel from public.channels where posts_chat_id = new.chat_id;

  -- Без времени: оно бывает скрыто от части слушателей, а строку клиент
  -- всё равно перечитывает из базы.
  payload := jsonb_build_object(
    'message_id', new.id,
    'chat_id', new.chat_id,
    'author_id', new.author_id,
    'author_name', author_name,
    'kind', new.kind,
    'text', preview_text
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

create or replace function public.handle_messages_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected record;
  last_live public.messages;
  preview_changed boolean;
  member record;
begin
  for affected in
    select n.chat_id, array_agg(n.id) as ids, max(n.seq) as newest
    from new_rows n
    join old_rows o on o.id = n.id
    where o.deleted_at is null and n.deleted_at is not null
    group by n.chat_id
  loop
    update public.message_pins
    set deleted_at = now()
    where (message_id = any (affected.ids) or forward_id = any (affected.ids))
      and deleted_at is null;

    -- Превью меняется, только если удалили самое свежее из живых.
    preview_changed := not exists (
      select 1 from public.messages m
      where m.chat_id = affected.chat_id and m.deleted_at is null and m.seq > affected.newest
    );

    if preview_changed then
      select * into last_live
      from public.messages
      where chat_id = affected.chat_id and deleted_at is null
      order by seq desc
      limit 1;

      update public.chats
      set
        last_message_text = case
          when last_live.id is null then null
          else public.message_preview_text(last_live)
        end,
        last_message_author_id = last_live.author_id
      where id = affected.chat_id;
    end if;

    begin
      perform realtime.send(
        jsonb_build_object('chat_id', affected.chat_id, 'message_ids', to_jsonb(affected.ids)),
        'messages_deleted',
        'chat:' || affected.chat_id::text,
        true
      );

      if preview_changed then
        for member in
          select user_id from public.chat_members where chat_id = affected.chat_id
        loop
          perform realtime.send(
            jsonb_build_object('chat_id', affected.chat_id),
            'chat_changed',
            'user:' || member.user_id::text,
            true
          );
        end loop;

        for member in
          select invitee_id as user_id from public.chat_invites
          where chat_id = affected.chat_id and status = 'pending' and invitee_id is not null
        loop
          perform realtime.send(
            jsonb_build_object('chat_id', affected.chat_id),
            'invite_activity',
            'user:' || member.user_id::text,
            true
          );
        end loop;
      end if;
    exception
      when others then null;
    end;
  end loop;

  return null;
end;
$$;

-- =============================================================================
-- Прочтение чата
-- =============================================================================

/**
 * Отметка «прочитано» — в топик чата, только если время чата не скрыто ни
 * от кого: момент прочтения в скрытом чате — тот же сигнал активности.
 * Время в payload больше не идёт: подписчик перечитывает чат.
 */
create or replace function public.broadcast_read_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.last_read_at is not distinct from old.last_read_at then
    return new;
  end if;

  if (select time_restricted from public.chats where id = new.chat_id) then
    return new;
  end if;

  begin
    perform realtime.send(
      jsonb_build_object('chat_id', new.chat_id, 'user_id', new.user_id),
      'read',
      'chat:' || new.chat_id::text,
      true
    );
  exception
    when others then null;
  end;

  return new;
end;
$$;

drop function public.mark_chat_read(uuid);

/** Моя отметка прочтения — «сейчас» по часам сервера. */
create function public.mark_chat_read(target_chat uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.chat_members
  set last_read_at = now()
  where chat_id = target_chat and user_id = auth.uid()
$$;

revoke execute on function public.mark_chat_read(uuid) from public, anon;
grant execute on function public.mark_chat_read(uuid) to authenticated;

/** До какого момента чат прочитали все, кроме смотрящего. `null` — читать некому или время скрыто. */
create or replace function public.chat_read_up_to(public.chats)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select min(cm.last_read_at)
  from public.chat_members cm
  where cm.chat_id = $1.id
    and cm.user_id is distinct from auth.uid()
    and public.chat_time_visible($1.id)
$$;

-- Имя чата по участникам — в порядке вступления, а порядок теперь закрыт
-- от клиента: функция читает его с правами владельца.
create or replace function public.chat_display_name(public.chats)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select ch.title from public.channels ch where ch.posts_chat_id = $1.id),
    nullif(btrim($1.title), ''),
    (
      select string_agg(coalesce(p.display_name, 'Без имени'), case when $1.kind = 'direct' then ' и ' else ', ' end order by m.joined_at)
      from (
        select cm.user_id, cm.joined_at
        from public.chat_members cm
        where cm.chat_id = $1.id and cm.user_id is distinct from auth.uid()
        order by cm.joined_at
        limit 3
      ) m
      join public.profiles p on p.id = m.user_id
    ),
    case when $1.kind = 'group' then 'Групповой чат' else 'Диалог' end
  )
$$;

-- =============================================================================
-- Участники и «Чаты»
-- =============================================================================

/**
 * Участники чатов с профилями — по порядку вступления (`position`, с нуля).
 * Отметка прочтения и момент вступления — null, если время чата скрыто от
 * смотрящего.
 */
create function public.chat_people(chat_ids uuid[])
returns table (
  chat_id uuid,
  user_id uuid,
  display_name text,
  avatar_url text,
  username text,
  last_read_at timestamptz,
  joined_at timestamptz,
  "position" int
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  if coalesce(cardinality(chat_ids), 0) > 500 then
    raise exception 'Слишком много чатов за раз' using errcode = '22023';
  end if;

  return query
  select
    cm.chat_id,
    cm.user_id,
    p.display_name,
    p.avatar_url,
    p.username,
    case when v.visible then cm.last_read_at end,
    case when v.visible then cm.joined_at end,
    (row_number() over (partition by cm.chat_id order by cm.joined_at, cm.user_id) - 1)::int
  from public.chat_members cm
  join public.chats c on c.id = cm.chat_id and c.deleted_at is null
  left join public.profiles p on p.id = cm.user_id
  cross join lateral (select public.chat_time_visible(cm.chat_id) as visible) v
  where cm.chat_id = any (chat_ids)
  order by cm.chat_id, cm.joined_at, cm.user_id;
end;
$$;

revoke execute on function public.chat_people(uuid[]) from public, anon;
grant execute on function public.chat_people(uuid[]) to authenticated;

/**
 * Мои «Чаты» по порядку: участие, каналы, которые я читаю в «Чатах», и
 * подписки на чужие диалоги. Место считается по настоящему времени —
 * позднее из последнего сообщения (или попа канала) и моего входа, — но
 * наружу отдаётся только номер места (`position`, с нуля) и `entered_at`,
 * скрытый так же, как время чата. Непрочитанное участника — тоже здесь:
 * клиент его больше не сравнит сам.
 */
create function public.my_chat_list()
returns table (
  chat_id uuid,
  entered_at timestamptz,
  "position" int,
  has_unread boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  return query
  with mine as (
    select cm.chat_id, cm.joined_at as entered, cm.last_read_at, true as member
    from public.chat_members cm
    where cm.user_id = me
    union all
    select coalesce(s.chat_id, ch.posts_chat_id), s.in_chats_at, null, false
    from public.subscriptions s
    left join public.channels ch on ch.id = s.channel_id
    where s.subscriber_id = me
      and (s.chat_id is not null or s.in_chats)
  ),
  deduped as (
    select distinct on (m.chat_id) m.*
    from mine m
    where m.chat_id is not null
    order by m.chat_id, m.member desc
  ),
  facts as (
    select
      d.chat_id,
      d.entered,
      d.member,
      d.last_read_at,
      last.created_at as last_at,
      last.author_id as last_author,
      ch.last_pop_at
    from deduped d
    join public.chats c on c.id = d.chat_id and c.deleted_at is null
    left join public.channels ch on ch.posts_chat_id = c.id
    left join lateral (
      select m.created_at, m.author_id
      from public.messages m
      where m.chat_id = d.chat_id and m.deleted_at is null
      order by m.seq desc
      limit 1
    ) last on true
  )
  select
    f.chat_id,
    case when public.chat_time_visible(f.chat_id) then f.entered end,
    (row_number() over (
      order by greatest(f.last_at, f.last_pop_at, f.entered) desc nulls last, f.chat_id
    ) - 1)::int,
    f.member and f.last_at is not null and f.last_author is distinct from me
      and f.last_at > coalesce(f.last_read_at, '-infinity'::timestamptz)
  from facts f;
end;
$$;

revoke execute on function public.my_chat_list() from public, anon;
grant execute on function public.my_chat_list() to authenticated;

-- =============================================================================
-- Выборки, которые читали время напрямую
-- =============================================================================

drop function public.latest_chat_messages(uuid[], int);

/** Последние сообщения нескольких чатов — для карточек заявок, свежие сверху. */
create function public.latest_chat_messages(chat_ids uuid[], per_chat int default 3)
returns setof public.message_rows
language sql
stable
set search_path = public
as $$
  select m.*
  from unnest(chat_ids) as target(id)
  cross join lateral (
    select *
    from public.message_rows
    where chat_id = target.id
    order by seq desc
    limit least(greatest(per_chat, 1), 20)
  ) m;
$$;

revoke execute on function public.latest_chat_messages(uuid[], int) from public, anon;
grant execute on function public.latest_chat_messages(uuid[], int) to authenticated;

drop function public.message_edits(uuid[]);

/** Номер правки у правленых сообщений — чтобы узнать устаревшее, не зная времени. */
create function public.message_edits(message_ids uuid[])
returns table (id uuid, edit_mark int, edited_at timestamptz)
language plpgsql
stable
set search_path = public
as $$
begin
  if cardinality(message_ids) > 1000 then
    raise exception 'too many messages in one call' using errcode = '22023';
  end if;

  return query
    select m.id, m.edit_mark, m.edited_at
    from public.message_rows m
    where m.id = any (message_ids) and m.edited;
end;
$$;

revoke execute on function public.message_edits(uuid[]) from public, anon;
grant execute on function public.message_edits(uuid[]) to authenticated;

drop function public.list_chat_media(uuid, timestamptz, uuid, int);

/**
 * Фото и видео сообщений чата, страницей: свежие сообщения сверху, внутри
 * альбома — по порядку. Курсор — номер самого старого сообщения прошлой
 * страницы. Время — null, если скрыто.
 */
create function public.list_chat_media(
  target_chat uuid,
  before_seq bigint default null,
  page_size int default 30
)
returns table (
  attachment_id uuid,
  message_id uuid,
  seq bigint,
  created_at timestamptz,
  "position" int,
  url text,
  poster_url text,
  mime_type text,
  width int,
  height int,
  duration_ms int
)
language sql
stable
set search_path = public
as $$
  with page as (
    select m.id, m.seq, m.created_at
    from public.message_rows m
    where m.chat_id = target_chat
      and m.kind = 'media'
      and (before_seq is null or m.seq < before_seq)
      and exists (
        select 1 from public.attachments a
        where a.message_id = m.id
          and a.pop_id is null
          and (a.mime_type like 'image/%' or a.mime_type like 'video/%')
      )
    order by m.seq desc
    limit least(greatest(page_size, 1), 100)
  )
  select a.id, p.id, p.seq, p.created_at, a.position, a.url, a.poster_url, a.mime_type,
         a.width, a.height, a.duration_ms
  from page p
  join public.attachments a on a.message_id = p.id
  where a.pop_id is null
    and (a.mime_type like 'image/%' or a.mime_type like 'video/%')
  order by p.seq desc, a.position asc;
$$;

revoke execute on function public.list_chat_media(uuid, bigint, int) from public, anon;
grant execute on function public.list_chat_media(uuid, bigint, int) to authenticated;

drop function public.list_chat_voices(uuid, timestamptz, uuid, int);

/** Голосовые и кружки чата, свежие сверху, страницей по номеру. */
create function public.list_chat_voices(
  target_chat uuid,
  before_seq bigint default null,
  page_size int default 30
)
returns table (
  message_id uuid,
  kind text,
  seq bigint,
  created_at timestamptz,
  author_id uuid,
  author_name text,
  attachment_id uuid,
  url text,
  poster_url text,
  mime_type text,
  duration_ms int,
  waveform smallint[]
)
language sql
stable
set search_path = public
as $$
  select m.id, m.kind, m.seq, m.created_at, m.author_id, pr.display_name,
         a.id, a.url, a.poster_url, a.mime_type, a.duration_ms, a.waveform
  from public.message_rows m
  join public.attachments a on a.message_id = m.id
  left join public.profiles pr on pr.id = m.author_id
  where m.chat_id = target_chat
    and m.kind in ('voice', 'video_note')
    and (before_seq is null or m.seq < before_seq)
  order by m.seq desc
  limit least(greatest(page_size, 1), 100);
$$;

revoke execute on function public.list_chat_voices(uuid, bigint, int) from public, anon;
grant execute on function public.list_chat_voices(uuid, bigint, int) to authenticated;

-- =============================================================================
-- Права служебных функций
-- =============================================================================

revoke execute on function public.chat_time_restricted_now(uuid) from public, anon, authenticated;
revoke execute on function public.refresh_chat_time_restricted(uuid) from public, anon, authenticated;
revoke execute on function public.on_chat_member_time_restriction() from public, anon, authenticated;
revoke execute on function public.on_privacy_time_setting_changed() from public, anon, authenticated;
revoke execute on function public.message_edit_count(uuid) from public, anon;
grant execute on function public.message_edit_count(uuid) to authenticated;
-- Зовётся представлением с правами смотрящего; ответ — только про него самого.
revoke execute on function public.chat_time_visible(uuid) from public, anon;
grant execute on function public.chat_time_visible(uuid) to authenticated;
