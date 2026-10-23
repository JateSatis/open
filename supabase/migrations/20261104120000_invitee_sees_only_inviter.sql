-- Позванному без подмены виден только позвавший, а не весь чат.
--
-- 20261104110000 снял подмену со всех участников для позванного. Но позвать
-- может любой участник, и позванный, даже отклонив, уносил настоящие id и
-- имена всех, кто скрывал себя в диалогах. Позвавший же раскрыт позванному и
-- так — карточкой приглашения (inviter_name, вне диалога). Теперь в составе и
-- превью чата позвавший — под тем же именем, что в карточке, остальные — под
-- псевдонимом чата, пока позванный не вступит. Отклонивший — снова посторонний.

create or replace function public.dialogue_masked(p_person uuid, p_viewer uuid, p_chat uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_chat is not null
    and p_person is not null
    and p_viewer is distinct from p_person
    and exists (select 1 from public.chats c where c.id = p_chat and c.kind in ('direct', 'group'))
    and not exists (select 1 from public.chat_members where chat_id = p_chat and user_id = p_viewer)
    and not exists (
      select 1 from public.chat_invites
      where chat_id = p_chat and invitee_id = p_viewer and inviter_id = p_person and status = 'pending'
    )
    and not public.identity_allows(
      (select s.dialogue_participant_name_masking from public.privacy_settings s where s.user_id = p_person),
      p_person,
      p_viewer
    )
    and public.chat_participant(p_chat, p_person)
$$;
revoke execute on function public.dialogue_masked(uuid, uuid, uuid) from public, anon, authenticated;

-- Что сторона видит о дружбе — одно определение: сигнал friends_changed
-- (on_friendship_signal) и ответы функций дружбы не могут разойтись.
create or replace function public.friendship_status_for(p_viewer uuid, p_other uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.friendship_seen_as(public.friendship_of(p_viewer, p_other), p_viewer)
$$;
revoke execute on function public.friendship_status_for(uuid, uuid) from public, anon, authenticated;
