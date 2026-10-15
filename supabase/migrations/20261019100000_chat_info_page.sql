-- Страница информации о чате: «был(а) в …», выборки медиа, голосовых и общих
-- групп для её вкладок, сводка счётчиков и смена названия группы.
--
-- Выборки — `security invoker`: читают через RLS, как и клиент, поэтому
-- мягко удалённые сообщения и всё, что политики спрячут позже (блокировки),
-- в страницу не попадут без отдельной заботы здесь.

-- =============================================================================
-- profiles.last_seen_at — публичная отметка «был(а) в …»
-- =============================================================================

-- Читают все, как и остальной профиль: «был(а) в 16:10» показывается всем,
-- настройки скрытия нет. Пишет только `mark_seen` — права на колонку у
-- клиента нет (список колонок в `grant update` на profiles её не включает).
alter table public.profiles add column last_seen_at timestamptz;

/**
 * Отметить себя «был(а) сейчас». Клиент зовёт при уходе приложения в фон,
 * при возврате и изредка, пока оно открыто. Чаще раза в 30 с строку не
 * трогает: отметка нужна с точностью до минуты, а не до каждого вызова.
 */
create function public.mark_seen()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set last_seen_at = now()
  where id = auth.uid()
    and (last_seen_at is null or last_seen_at < now() - interval '30 seconds');
$$;

revoke execute on function public.mark_seen() from public, anon;
grant execute on function public.mark_seen() to authenticated;

-- =============================================================================
-- Индексы под вкладки
-- =============================================================================

-- `messages` — самая горячая таблица, а сообщения с медиа и голосовые — малая
-- её доля: без частичных индексов выборка шла бы по всем сообщениям чата
-- подряд, отбрасывая текст.
create index messages_chat_media_idx
  on public.messages (chat_id, created_at desc, id desc)
  where kind = 'media' and deleted_at is null;

create index messages_chat_voice_idx
  on public.messages (chat_id, created_at desc, id desc)
  where kind in ('voice', 'video_note') and deleted_at is null;

-- =============================================================================
-- Выборки
-- =============================================================================

/**
 * Фото и видео сообщений чата, страницей: свежие сообщения сверху, внутри
 * альбома — по порядку в альбоме. Страница — `page_size` сообщений, а не
 * вложений: альбом не рвётся между страницами. Курсор — время и id самого
 * старого сообщения прошлой страницы. Ссылки на попсы и содержимое островков
 * пересылки сюда не входят.
 */
create function public.list_chat_media(
  target_chat uuid,
  before_at timestamptz default null,
  before_id uuid default null,
  page_size int default 30
)
returns table (
  attachment_id uuid,
  message_id uuid,
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
security invoker
set search_path = public
as $$
  with page as (
    select m.id, m.created_at
    from public.messages m
    where m.chat_id = target_chat
      and m.kind = 'media'
      and m.deleted_at is null
      and (before_at is null or (m.created_at, m.id) < (before_at, before_id))
      and exists (
        select 1 from public.attachments a
        where a.message_id = m.id
          and a.pop_id is null
          and (a.mime_type like 'image/%' or a.mime_type like 'video/%')
      )
    order by m.created_at desc, m.id desc
    limit least(greatest(page_size, 1), 100)
  )
  select a.id, p.id, p.created_at, a.position, a.url, a.poster_url, a.mime_type,
         a.width, a.height, a.duration_ms
  from page p
  join public.attachments a on a.message_id = p.id
  where a.pop_id is null
    and (a.mime_type like 'image/%' or a.mime_type like 'video/%')
  order by p.created_at desc, p.id desc, a.position asc;
$$;

revoke execute on function public.list_chat_media(uuid, timestamptz, uuid, int) from public, anon;
grant execute on function public.list_chat_media(uuid, timestamptz, uuid, int) to authenticated;

/**
 * Голосовые и кружки чата, страницей, свежие сверху, с автором. Курсор — как у
 * `list_chat_media`. Автор удалённого аккаунта — пустое имя.
 */
create function public.list_chat_voices(
  target_chat uuid,
  before_at timestamptz default null,
  before_id uuid default null,
  page_size int default 30
)
returns table (
  message_id uuid,
  kind text,
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
security invoker
set search_path = public
as $$
  select m.id, m.kind, m.created_at, m.author_id, pr.display_name,
         a.id, a.url, a.poster_url, a.mime_type, a.duration_ms, a.waveform
  from public.messages m
  join public.attachments a on a.message_id = m.id
  left join public.profiles pr on pr.id = m.author_id
  where m.chat_id = target_chat
    and m.kind in ('voice', 'video_note')
    and m.deleted_at is null
    and (before_at is null or (m.created_at, m.id) < (before_at, before_id))
  order by m.created_at desc, m.id desc
  limit least(greatest(page_size, 1), 100);
$$;

revoke execute on function public.list_chat_voices(uuid, timestamptz, uuid, int) from public, anon;
grant execute on function public.list_chat_voices(uuid, timestamptz, uuid, int) to authenticated;

/**
 * Группы, где состоим и я, и `other_user`, — свежие по созданию сверху.
 * Курсор — время создания и id последней группы прошлой страницы.
 */
create function public.list_common_groups(
  other_user uuid,
  before_at timestamptz default null,
  before_id uuid default null,
  page_size int default 30
)
returns table (
  chat_id uuid,
  title text,
  username text,
  avatar_url text,
  members_count int,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select c.id, c.title, c.username, c.avatar_url,
         (select count(*)::int from public.chat_members cm where cm.chat_id = c.id),
         c.created_at
  from public.chats c
  where c.kind = 'group'
    and c.deleted_at is null
    and auth.uid() is not null
    and other_user <> auth.uid()
    and exists (
      select 1 from public.chat_members me
      where me.chat_id = c.id and me.user_id = auth.uid()
    )
    and exists (
      select 1 from public.chat_members them
      where them.chat_id = c.id and them.user_id = other_user
    )
    and (before_at is null or (c.created_at, c.id) < (before_at, before_id))
  order by c.created_at desc, c.id desc
  limit least(greatest(page_size, 1), 100);
$$;

revoke execute on function public.list_common_groups(uuid, timestamptz, uuid, int) from public, anon;
grant execute on function public.list_common_groups(uuid, timestamptz, uuid, int) to authenticated;

/**
 * Сводка для страницы чата: создатель (у группы — «владелец») и счётчики
 * вкладок. По нулям страница прячет пустые вкладки, по числам строит
 * подзаголовок («58 фото, 8 видео»). Общие группы считаются только участнику
 * личного диалога — между ним и собеседником; остальным — 0.
 */
create function public.chat_info_summary(target_chat uuid)
returns table (
  owner_id uuid,
  photos int,
  videos int,
  voices int,
  common_groups int
)
language sql
stable
security invoker
set search_path = public
as $$
  with chat as (
    select c.id, c.kind, c.created_by
    from public.chats c
    where c.id = target_chat and c.deleted_at is null
  ),
  media as (
    select
      count(*) filter (where a.mime_type like 'image/%')::int as photos,
      count(*) filter (where a.mime_type like 'video/%')::int as videos
    from public.messages m
    join public.attachments a on a.message_id = m.id
    where m.chat_id = target_chat
      and m.kind = 'media'
      and m.deleted_at is null
      and a.pop_id is null
  ),
  voices as (
    select count(*)::int as voices
    from public.messages m
    where m.chat_id = target_chat
      and m.kind in ('voice', 'video_note')
      and m.deleted_at is null
  ),
  other as (
    select cm.user_id
    from chat
    join public.chat_members cm on cm.chat_id = chat.id
    where chat.kind = 'direct'
      and cm.user_id <> auth.uid()
      and exists (
        select 1 from public.chat_members mine
        where mine.chat_id = chat.id and mine.user_id = auth.uid()
      )
    limit 1
  )
  select
    case when chat.kind = 'group' then chat.created_by end,
    media.photos,
    media.videos,
    voices.voices,
    coalesce((
      select count(*)::int
      from other
      join public.chat_members them on them.user_id = other.user_id
      join public.chats g on g.id = them.chat_id and g.kind = 'group' and g.deleted_at is null
      where exists (
        select 1 from public.chat_members me
        where me.chat_id = g.id and me.user_id = auth.uid()
      )
    ), 0)
  from chat, media, voices;
$$;

revoke execute on function public.chat_info_summary(uuid) from public, anon;
grant execute on function public.chat_info_summary(uuid) to authenticated;

-- =============================================================================
-- Название группы
-- =============================================================================

/**
 * Сменить или убрать (`null` / пустая строка) название группы. Право — то же,
 * что у прямой правки строки по политике `chats`: только создатель (права
 * шире — этап управления группой). Через функцию — чтобы участники и ещё не
 * ответившие на заявку узнали о смене сразу, как о смене фото.
 */
create function public.set_chat_title(target_chat uuid, new_title text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  target_kind text;
  creator uuid;
  member record;
begin
  if me is null then
    raise exception 'Требуется аутентификация' using errcode = '28000';
  end if;

  select kind, created_by into target_kind, creator
  from public.chats
  where id = target_chat and deleted_at is null
  for update;

  if target_kind is null then
    raise exception 'Чат не найден' using errcode = 'P0002';
  end if;

  if target_kind <> 'group' then
    raise exception 'Название бывает только у группы' using errcode = '22023';
  end if;

  if creator is distinct from me then
    raise exception 'Менять название группы может только её создатель' using errcode = '42501';
  end if;

  update public.chats set title = nullif(btrim(new_title), '') where id = target_chat;

  -- Название обязано сохраниться, даже если Realtime недоступен.
  begin
    for member in
      select user_id from public.chat_members where chat_id = target_chat
      union
      select invitee_id from public.chat_invites
      where chat_id = target_chat and status = 'pending'
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
end;
$$;

revoke execute on function public.set_chat_title(uuid, text) from public, anon;
grant execute on function public.set_chat_title(uuid, text) to authenticated;
