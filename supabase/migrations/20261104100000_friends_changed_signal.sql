-- Сигнал о дружбе в личный топик: входящая заявка, принятие, удаление из
-- друзей. Без него счётчик заявок на строке «Друзья» и кнопка в профиле
-- обновлялись только после перезапуска приложения — вкладка «Профиль» не
-- размонтируется.
--
-- Сторона получает `friends_changed`, только если изменилось то, что видит
-- она сама (`friendship_status_for`): отказ отправителю не раскрывается ни
-- состоянием, ни самим фактом сигнала. Людей в payload нет — клиент
-- перечитывает свои запросы.

-- Что видит p_viewer по строке пары (null — строки нет). Повторяет
-- friendship_status_for, но по переданной строке: в триггере нужны и OLD, и NEW.
create function public.friendship_seen_as(f public.friendships, p_viewer uuid)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when f.id is null then 'none'
    when f.status = 'accepted' then 'friends'
    when f.requester_id = p_viewer then case when f.withdrawn_at is null then 'outgoing' else 'none' end
    when f.status = 'pending' then 'incoming'
    else 'none'
  end
$$;

create function public.on_friendship_signal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  side uuid;
  was public.friendships;
  now_row public.friendships;
begin
  if tg_op <> 'INSERT' then was := old; end if;
  if tg_op <> 'DELETE' then now_row := new; end if;

  foreach side in array array[
    coalesce(new.requester_id, old.requester_id),
    coalesce(new.addressee_id, old.addressee_id)
  ] loop
    if public.friendship_seen_as(was, side) is distinct from public.friendship_seen_as(now_row, side) then
      begin
        perform realtime.send('{}'::jsonb, 'friends_changed', 'user:' || side::text, true);
      exception
        when others then null;
      end;
    end if;
  end loop;

  return null;
end;
$$;

create trigger friendships_signal
  after insert or update or delete on public.friendships
  for each row execute function public.on_friendship_signal();

revoke execute on function public.friendship_seen_as(public.friendships, uuid) from public, anon, authenticated;
revoke execute on function public.on_friendship_signal() from public, anon, authenticated;
