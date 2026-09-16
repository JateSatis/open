-- Messenger core: profiles, chats, chat_members, messages, attachments.
-- Comments/reactions, posts/excerpts, streams/clips and feed_items are out
-- of scope for this migration — see CLAUDE.md section 2a for the full model.

-- =============================================================================
-- profiles
-- =============================================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index profiles_username_key on public.profiles (username) where username is not null;

alter table public.profiles enable row level security;

create policy "profiles are readable by authenticated users"
  on public.profiles for select
  to authenticated
  using (deleted_at is null);

create policy "profiles are editable by their owner"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- =============================================================================
-- chats
-- =============================================================================

create table public.chats (
  id uuid primary key default gen_random_uuid (),
  kind text not null check (kind in ('direct', 'group')),
  title text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.chats enable row level security;

create policy "chats are readable by authenticated users"
  on public.chats for select
  to authenticated
  using (deleted_at is null);

create policy "chats are created by their author"
  on public.chats for insert
  to authenticated
  with check (auth.uid() = created_by);

create policy "chats are editable by their creator"
  on public.chats for update
  to authenticated
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

-- =============================================================================
-- chat_members
-- =============================================================================

create table public.chat_members (
  id uuid primary key default gen_random_uuid (),
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (chat_id, user_id)
);

create index chat_members_chat_id_idx on public.chat_members (chat_id);
create index chat_members_user_id_idx on public.chat_members (user_id);

alter table public.chat_members enable row level security;

create policy "chat_members are readable by authenticated users"
  on public.chat_members for select
  to authenticated
  using (true);

create policy "chat_members can be added by themselves or existing members"
  on public.chat_members for insert
  to authenticated
  with check (
    auth.uid() = user_id
    or auth.uid() in (
      select user_id from public.chat_members where chat_id = chat_members.chat_id
    )
  );

create policy "chat_members can remove themselves"
  on public.chat_members for delete
  to authenticated
  using (auth.uid() = user_id);

-- =============================================================================
-- messages
-- =============================================================================

create table public.messages (
  id uuid primary key default gen_random_uuid (),
  chat_id uuid not null references public.chats (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('text', 'photo', 'video', 'voice', 'video_note', 'system')),
  text text,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  unique (id, kind)
);

create index messages_chat_id_created_at_idx on public.messages (chat_id, created_at desc);

alter table public.messages enable row level security;

create policy "messages are readable by authenticated users"
  on public.messages for select
  to authenticated
  using (deleted_at is null);

create policy "messages can only be sent by chat members"
  on public.messages for insert
  to authenticated
  with check (
    auth.uid() = author_id
    and auth.uid() in (
      select user_id from public.chat_members where chat_id = messages.chat_id
    )
  );

create policy "messages are editable by their author"
  on public.messages for update
  to authenticated
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

-- =============================================================================
-- attachments
-- =============================================================================

create table public.attachments (
  id uuid primary key default gen_random_uuid (),
  message_id uuid not null,
  message_kind text not null,
  url text not null,
  mime_type text,
  width int,
  height int,
  duration_ms int,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  foreign key (message_id, message_kind) references public.messages (id, kind) on delete cascade
);

create index attachments_message_id_idx on public.attachments (message_id);

-- A voice message or video note is exactly one piece of media: a message
-- with two voice attachments cannot be rendered and would break excerpts
-- that quote it, so this is a schema invariant, not a client-side check.
create unique index attachments_single_media
  on public.attachments (message_id)
  where message_kind in ('voice', 'video_note');

alter table public.attachments enable row level security;

create policy "attachments are readable when their message is visible"
  on public.attachments for select
  to authenticated
  using (
    exists (
      select 1 from public.messages
      where messages.id = attachments.message_id
        and messages.deleted_at is null
    )
  );

create policy "attachments can only be added by the message author"
  on public.attachments for insert
  to authenticated
  with check (
    auth.uid() = (select author_id from public.messages where id = attachments.message_id)
  );

-- =============================================================================
-- new user -> profile
-- =============================================================================

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
