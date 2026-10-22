-- Приватность, этап 5: «Кто видит мои фото, видео и голосовые»
-- (`dialogue_media_visibility`).
--
-- Медиа человека — фото, видео, кружки и голосовые, которые он отправил сам
-- в любом чате или в комментарии, — видят:
--   * сам автор;
--   * участники чата, куда медиа отправлено (у комментария — участники чата
--     комментария), всегда;
--   * остальные — по настройке автора (`privacy_allows`).
-- Медиа поста канала — контент канала, не человека: видно всем.
--
-- Зрителю вне области база не отдаёт ни файл, ни путь к нему:
--   * файлы — в закрытом бакете `chat-media`; Storage подписывает ссылку
--     только тому, кому файл открыт (`chat_media_object_readable`);
--   * вложения клиент читает из представлений `attachment_rows` и
--     `comment_attachment_rows`: путь, постер и волна голосового — null,
--     `media_hidden` — true; вид, размеры и длительность остаются для плитки
--     «скрыто автором». Таблицы `attachments` и `comment_attachments` клиенту
--     больше не читаются.
-- Островки, цитаты, пересылки и вкладки страницы информации читают те же
-- строки, поэтому правило действует везде, где медиа автора появляется.

-- =============================================================================
-- Кому видно медиа автора
-- =============================================================================

create function public.media_visible(p_author uuid, p_chat uuid, p_channel boolean)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    p_channel
    or p_author = auth.uid()
    or exists (
      select 1 from public.chat_members cm
      where cm.chat_id = p_chat and cm.user_id = auth.uid()
    )
    or public.privacy_allows('dialogue_media_visibility', p_author, auth.uid())
  )
$$;

/**
 * Вложение сообщения глазами смотрящего: видно ли оно вообще (повторяет
 * SELECT-политику `messages`, как `message_rows`) и открыт ли его файл.
 */
create function public.attachment_access(p_message uuid)
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
      end,
    public.media_visible(m.author_id, m.chat_id, c.kind = 'channel_posts')
  from public.messages m
  join public.chats c on c.id = m.chat_id
  where m.id = p_message
$$;

/** Вложение комментария: SELECT-политика `comments` и настройка автора. */
create function public.comment_attachment_access(p_comment uuid)
returns table (visible boolean, shown boolean)
language sql
stable
security definer
rows 1
set search_path = public
as $$
  select
    c.deleted_at is null
      and (c.author_id is null or c.author_id <> all ((select public.my_block_peers())::uuid[])),
    public.media_visible(c.author_id, c.chat_id, false)
  from public.comments c
  where c.id = p_comment
$$;

-- =============================================================================
-- Строки вложений глазами смотрящего
-- =============================================================================

-- Внешние ключи (message_id + message_kind, pop_id, comment_id + comment_kind)
-- — прямыми колонками: по ним PostgREST выводит связи с message_rows,
-- comment_rows и pops. Время вложения не отдаётся — это время сообщения.
create view public.attachment_rows as
select
  a.id,
  a.message_id,
  a.message_kind,
  a.pop_id,
  a.position,
  a.mime_type,
  a.width,
  a.height,
  a.duration_ms,
  a.size_bytes,
  case when s.shown then a.url end as url,
  case when s.shown then a.poster_url end as poster_url,
  case when s.shown then a.waveform end as waveform,
  not s.shown as media_hidden
from public.attachments a
cross join lateral public.attachment_access(a.message_id) x(visible, shown)
-- Ссылка на поп — файл попа, он публичный.
cross join lateral (select x.shown or a.pop_id is not null as shown) s
where x.visible;

create view public.comment_attachment_rows as
select
  a.id,
  a.comment_id,
  a.comment_kind,
  a.position,
  a.mime_type,
  a.width,
  a.height,
  a.duration_ms,
  a.size_bytes,
  case when x.shown then a.url end as url,
  case when x.shown then a.poster_url end as poster_url,
  case when x.shown then a.waveform end as waveform,
  not x.shown as media_hidden
from public.comment_attachments a
cross join lateral public.comment_attachment_access(a.comment_id) x(visible, shown)
where x.visible;

revoke select on public.attachments from anon, authenticated;
revoke select on public.comment_attachments from anon, authenticated;

revoke all on public.attachment_rows from anon, authenticated;
revoke all on public.comment_attachment_rows from anon, authenticated;
grant select on public.attachment_rows to authenticated;
grant select on public.comment_attachment_rows to authenticated;

-- =============================================================================
-- Файлы
-- =============================================================================

create index attachments_url_idx on public.attachments (url) where url is not null;
create index attachments_poster_url_idx on public.attachments (poster_url) where poster_url is not null;
create index comment_attachments_url_idx on public.comment_attachments (url);
create index comment_attachments_poster_url_idx
  on public.comment_attachments (poster_url) where poster_url is not null;

/**
 * Может ли смотрящий открыть файл `chat-media`: это файл или постер
 * вложения, которое он видит, и автор открыл ему медиа. Файл, который ни к
 * чему не прикреплён (несостоявшаяся отправка, убранный правкой), не читает
 * никто, кроме владельца.
 */
create function public.chat_media_object_readable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    exists (
      select 1
      from public.attachments a
      cross join lateral public.attachment_access(a.message_id) x(visible, shown)
      where (a.url = p_name or a.poster_url = p_name) and x.visible and x.shown
    )
    or exists (
      select 1
      from public.comment_attachments a
      cross join lateral public.comment_attachment_access(a.comment_id) x(visible, shown)
      where (a.url = p_name or a.poster_url = p_name) and x.visible and x.shown
    )
  )
$$;

-- Листинг чужих папок закрыт: политика пускает только к своему префиксу и к
-- открытым файлам по одному.
create policy "chat media is readable by whom its author shows it"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'chat-media'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.chat_media_object_readable(name)
    )
  );

-- =============================================================================
-- Страница информации о чате
-- =============================================================================

drop function public.list_chat_media(uuid, bigint, integer);

create function public.list_chat_media(
  target_chat uuid,
  before_seq bigint default null,
  page_size integer default 30
)
returns table (
  attachment_id uuid,
  message_id uuid,
  seq bigint,
  created_at timestamptz,
  "position" integer,
  url text,
  poster_url text,
  mime_type text,
  width integer,
  height integer,
  duration_ms integer,
  media_hidden boolean
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
        select 1 from public.attachment_rows a
        where a.message_id = m.id
          and a.pop_id is null
          and (a.mime_type like 'image/%' or a.mime_type like 'video/%')
      )
    order by m.seq desc
    limit least(greatest(page_size, 1), 100)
  )
  select a.id, p.id, p.seq, p.created_at, a.position, a.url, a.poster_url, a.mime_type,
         a.width, a.height, a.duration_ms, a.media_hidden
  from page p
  join public.attachment_rows a on a.message_id = p.id
  where a.pop_id is null
    and (a.mime_type like 'image/%' or a.mime_type like 'video/%')
  order by p.seq desc, a.position asc;
$$;

drop function public.list_chat_voices(uuid, bigint, integer);

create function public.list_chat_voices(
  target_chat uuid,
  before_seq bigint default null,
  page_size integer default 30
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
  duration_ms integer,
  waveform smallint[],
  author_opaque boolean,
  media_hidden boolean
)
language sql
stable
set search_path = public
as $$
  select m.id, m.kind, m.seq, m.created_at, m.author_id, m.author_name,
         a.id, a.url, a.poster_url, a.mime_type, a.duration_ms, a.waveform, m.author_opaque,
         a.media_hidden
  from public.message_rows m
  join public.attachment_rows a on a.message_id = m.id
  where m.chat_id = target_chat
    and m.kind in ('voice', 'video_note')
    and not m.hidden
    and (before_seq is null or m.seq < before_seq)
  order by m.seq desc
  limit least(greatest(page_size, 1), 100);
$$;

-- =============================================================================
-- Сигнал «медиа изменилось»
-- =============================================================================
--
-- Человек сменил, кому видно его медиа, — открытые экраны его чатов
-- перечитывают вложения и забывают подписанные ссылки. Уже выданная ссылка
-- живёт до своего срока (клиент подписывает на 15 минут).

create function public.on_media_setting_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chat record;
begin
  if new.dialogue_media_visibility is not distinct from old.dialogue_media_visibility then
    return null;
  end if;

  for chat in
    select cm.chat_id from public.chat_members cm where cm.user_id = new.user_id
  loop
    begin
      perform realtime.send(
        jsonb_build_object('chat_id', chat.chat_id),
        'media_changed',
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

create trigger privacy_settings_media_changed
  after update on public.privacy_settings
  for each row execute function public.on_media_setting_changed();

-- =============================================================================
-- Права
-- =============================================================================

revoke execute on function public.media_visible(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.attachment_access(uuid) from public, anon;
revoke execute on function public.comment_attachment_access(uuid) from public, anon;
revoke execute on function public.chat_media_object_readable(text) from public, anon;
revoke execute on function public.list_chat_media(uuid, bigint, integer) from public, anon;
revoke execute on function public.list_chat_voices(uuid, bigint, integer) from public, anon;
revoke execute on function public.on_media_setting_changed() from public, anon, authenticated;

-- Функции в представлениях и в политике Storage зовутся с правами смотрящего.
grant execute on function public.attachment_access(uuid) to authenticated;
grant execute on function public.comment_attachment_access(uuid) to authenticated;
grant execute on function public.chat_media_object_readable(text) to authenticated;
grant execute on function public.list_chat_media(uuid, bigint, integer) to authenticated;
grant execute on function public.list_chat_voices(uuid, bigint, integer) to authenticated;
