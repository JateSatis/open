-- Поиск участников на странице группы ищет и по `@имени` — у ещё не
-- принявших заявку тоже. View отдаёт его последней колонкой (`create or
-- replace view` добавляет колонки только в конец).
--
-- `chat_heir` не нужна: наследника страница знает сама — самый давний
-- участник, а участники приходят с чатом по порядку вступления.

create or replace view public.chat_waiting_invitees
with (security_invoker = false)
as
select
  i.chat_id,
  i.invitee_id as user_id,
  i.created_at as invited_at,
  p.display_name,
  p.avatar_url,
  p.username
from public.chat_invites i
join public.profiles p on p.id = i.invitee_id and p.deleted_at is null
where i.status <> 'accepted';

revoke all on public.chat_waiting_invitees from anon, authenticated;
grant select on public.chat_waiting_invitees to authenticated;

drop function public.chat_heir(uuid);
