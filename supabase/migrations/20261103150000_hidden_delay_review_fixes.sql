-- Скрытый текст и задержка: правки по ревью.
--
-- * Заявка на диалог не задерживается: её видят только двое, а получатель —
--   ещё не участник и для водораздела был бы зрителем: не увидел бы, что
--   ему пишут.
-- * Неопубликованное не выдаётся и через то, что висит на сообщении:
--   вложения (attachment_rows и файл в chat-media), комментарии (таблица и
--   comment_rows, их вложения), реакции (reactor_rows), цитаты ответов
--   (message_replies), цитаты и закрепы комментариев (comment_replies,
--   comment_pins). Ключ проверки — id цели: `target_seen`.
-- * fragment_rows повторяет видимость сообщения целиком (message_rows):
--   заглушка заблокировавшего и непринятая заявка цитату фрагмента не отдают.
-- * Смена задержки у участника — сигнал `chat_changed` в топики участников
--   его чатов: «печатает» в них пора спросить заново.

-- =============================================================================
-- Заявка на диалог не задерживается
-- =============================================================================

create or replace function public.assign_message_public_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  pending_until timestamptz;
begin
  new.delayed_until := null;
  new.public_at := now();

  select x.kind, x.request_pending into c from public.chats x where x.id = new.chat_id;

  -- Чат постов — контент канала; заявку видят только двое.
  if c.kind not in ('direct', 'group') or c.request_pending then
    return new;
  end if;

  if new.kind <> 'system'
    and new.author_id is not null
    and exists (
      select 1 from public.privacy_settings s
      where s.user_id = new.author_id and s.public_message_visibility_delay = 'random_delay'
    )
  then
    new.delayed_until := now() + make_interval(secs => public.random_publish_delay_seconds());
  end if;

  select max(m.public_at) into pending_until
  from public.messages m
  where m.chat_id = new.chat_id
    and m.deleted_at is null
    and m.public_at > m.created_at
    and m.public_at > now();

  new.public_at := greatest(now(), new.delayed_until, pending_until);

  return new;
end;
$$;

-- =============================================================================
-- Видна ли цель смотрящему
-- =============================================================================

/**
 * Цель комментария, реакции, цитаты: сообщение — видно ли оно смотрящему
 * (участнику — всегда, остальным — ниже водораздела); не сообщение (поп) —
 * да. Ключ — id цели: о неизвестном id клиент ничего не узнает.
 */
create or replace function public.target_seen(p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_target is null then true
    when not exists (select 1 from public.messages m where m.id = p_target) then true
    else coalesce((select s.seen from public.message_seen(p_target) s), false)
  end
$$;

/** Реакция — на видимое смотрящему: сообщение, его фрагмент, комментарий к нему. */
create or replace function public.reaction_target_seen(p_reaction uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.target_seen(
    case r.target_type
      when 'message' then r.target_id
      when 'fragment' then (select f.message_id from public.message_fragments f where f.id = r.target_id)
      when 'comment' then (select c.message_id from public.comments c where c.id = r.target_id)
    end
  )
  from public.reactions r
  where r.id = p_reaction
$$;

revoke execute on function public.target_seen(uuid) from public, anon;
revoke execute on function public.reaction_target_seen(uuid) from public, anon;
grant execute on function public.target_seen(uuid) to authenticated;
grant execute on function public.reaction_target_seen(uuid) to authenticated;

-- =============================================================================
-- Вложения
-- =============================================================================

create or replace function public.attachment_access(p_message uuid)
returns table (visible boolean, shown boolean)
language sql
stable
security definer
rows 1
set search_path = public
as $$
  select
    m.deleted_at is null
      and public.chat_readable(m.chat_id)
      and case
        when m.author_id = any ((select public.my_blockers())::uuid[]) and m.kind <> 'system'
          then public.blocker_message_visible(m.chat_id)
        else true
      end
      and public.target_seen(m.id),
    public.media_visible(m.author_id, m.chat_id, c.kind = 'channel_posts')
  from public.messages m
  join public.chats c on c.id = m.chat_id
  where m.id = p_message
$$;

create or replace function public.comment_attachment_access(p_comment uuid)
returns table (visible boolean, shown boolean)
language sql
stable
security definer
rows 1
set search_path = public
as $$
  select
    c.deleted_at is null
      and (c.author_id is null or c.author_id <> all ((select public.my_block_peers())::uuid[]))
      and public.target_seen(c.message_id),
    public.media_visible(c.author_id, c.chat_id, false)
  from public.comments c
  where c.id = p_comment
$$;

-- =============================================================================
-- Комментарии, реакции, цитаты
-- =============================================================================

create or replace view public.comment_rows as
select
  c.id,
  c.chat_id,
  c.message_id,
  p.author_id,
  c.kind,
  case when c.deleted_at is null then c.text end as text,
  c.audience,
  c.created_at,
  case when c.deleted_at is null then c.edited_at end as edited_at,
  c.deleted_at,
  case when c.deleted_at is null then c.member_reactions else '{}'::jsonb end as member_reactions,
  case when c.deleted_at is null then c.visitor_reactions else '{}'::jsonb end as visitor_reactions,
  case when c.deleted_at is null then c.reactions_count else 0 end as reactions_count,
  c.thread_root_id,
  c.replies_count,
  c.rank,
  c.pop_id,
  c.target_id,
  c.fragment_id,
  p.author_name,
  p.author_avatar_url,
  p.author_opaque
from public.comments c
cross join lateral public.comment_people(c.id) p
where (c.deleted_at is null or (c.thread_root_id is null and c.replies_count > 0))
  and (c.author_id is null or c.author_id <> all ((select public.my_block_peers())::uuid[]))
  and public.target_seen(c.message_id);

create or replace view public.reactor_rows as
select
  r.id,
  r.target_type,
  r.target_id,
  r.emoji,
  r.audience,
  r.created_at,
  r.updated_at,
  p.user_id,
  p.display_name,
  p.avatar_url,
  p.opaque
from public.reactions r
cross join lateral public.reaction_person(r.id) p
where r.deleted_at is null
  and (r.user_id is null or r.user_id <> all ((select public.my_block_peers())::uuid[]))
  and public.reaction_target_seen(r.id);

drop policy "comments are readable by authenticated users" on public.comments;

create policy "comments are readable by authenticated users"
  on public.comments for select
  to authenticated
  using (
    deleted_at is null
    and (author_id is null or author_id <> all ((select public.my_block_peers())::uuid[]))
    and public.target_seen(message_id)
  );

drop policy "message_replies are readable by authenticated users" on public.message_replies;

create policy "message_replies are readable by authenticated users"
  on public.message_replies for select
  to authenticated
  using (public.target_seen(message_id));

drop policy "comment_replies are readable by authenticated users" on public.comment_replies;

create policy "comment_replies are readable by authenticated users"
  on public.comment_replies for select
  to authenticated
  using (public.target_seen(target_id));

drop policy "comment_pins are readable by authenticated users" on public.comment_pins;

create policy "comment_pins are readable by authenticated users"
  on public.comment_pins for select
  to authenticated
  using (deleted_at is null and public.target_seen(target_id));

-- =============================================================================
-- Цитата фрагмента — видимость сообщения целиком
-- =============================================================================

create or replace view public.fragment_rows as
select
  f.id,
  f.message_id,
  f.chat_id,
  f.start_offset,
  f.end_offset,
  f.anchor_state,
  public.fragment_seen_text(f.id) as exact_text,
  f.created_at
from public.message_fragments f
where f.deleted_at is null
  and exists (
    select 1 from public.message_rows m where m.id = f.message_id and not m.hidden
  );

-- =============================================================================
-- Смена задержки — «печатает» спросить заново
-- =============================================================================

create or replace function public.on_delay_setting_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chat record;
begin
  if new.public_message_visibility_delay is not distinct from old.public_message_visibility_delay then
    return null;
  end if;

  for chat in
    select cm.chat_id from public.chat_members cm where cm.user_id = new.user_id
  loop
    begin
      perform realtime.send(
        jsonb_build_object('chat_id', chat.chat_id),
        'chat_changed',
        'chat-members:' || chat.chat_id::text,
        true
      );
    exception
      when others then null;
    end;
  end loop;

  return null;
end;
$$;

revoke execute on function public.on_delay_setting_changed() from public, anon, authenticated;

create trigger privacy_settings_delay_changed
  after update of public_message_visibility_delay on public.privacy_settings
  for each row execute function public.on_delay_setting_changed();
