-- `system_user_id` — только у строк состава. Прежняя проверка пропускала
-- обычное сообщение с этой ссылкой: у него `system_event` пустой, `null in
-- (...)` даёт null, а CHECK пропускает null. Участник прямым INSERT клал бы в
-- переписку сообщение со «вторым человеком события».

alter table public.messages drop constraint messages_system_user_only_member_event;

alter table public.messages add constraint messages_system_user_only_member_event check (
  system_user_id is null
  or coalesce(system_event in ('member_invited', 'member_removed', 'owner_changed'), false)
);
