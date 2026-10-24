-- Позванный в чат (висящее приглашение) видит людей чата как участник, а не
-- как посторонний.
--
-- Раньше в одной карточке один человек был под двумя именами: пригласивший —
-- по профильной настройке («Борис Тимофеев зовёт вас»), а в составе и превью
-- того же чата — под псевдонимом чата («В чате: Евгения Веселова»). В заявке
-- на диалог так же: «Василий Лазарев хочет начать диалог» и «Дарья Осипова:
-- текст заявки». Пригласивший уже открыт позванному, а приняв, позванный и так
-- увидит всех по профильным настройкам — псевдоним чата его ни от чего не
-- защищает, только путает. Отклонивший снова посторонний.

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
      where chat_id = p_chat and invitee_id = p_viewer and status = 'pending'
    )
    and not public.identity_allows(
      (select s.dialogue_participant_name_masking from public.privacy_settings s where s.user_id = p_person),
      p_person,
      p_viewer
    )
    and public.chat_participant(p_chat, p_person)
$$;
revoke execute on function public.dialogue_masked(uuid, uuid, uuid) from public, anon, authenticated;
