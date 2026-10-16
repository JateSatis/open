-- Кластеры фрагментов (этап 3б): ореол облачка — по показываемым кластерам.
--
-- Видимый фрагмент ещё не значит показываемый кластер: модель может не
-- показывать слабый кластер, а между первой реакцией и первым пересчётом
-- кластера нет вовсе. Ореол и вход участника в режим фрагментов обещают
-- подсветку — значит, считать надо то, что подсвечивается. Число держит
-- триггер на кластерах; клиент перечитывает его по сигналу `clusters_changed`,
-- который пересчёт уже шлёт в топик чата.

/** Показываемых кластеров фрагментов у сообщения — для ореола облачка. */
alter table public.messages
  add column clusters_count int not null default 0;

/** Показываемый кластер — живой и с диапазоном показа. */
create function public.count_cluster()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  was_shown boolean := tg_op <> 'INSERT' and old.deleted_at is null and old.display_start is not null;
  is_shown boolean := tg_op <> 'DELETE' and new.deleted_at is null and new.display_start is not null;
  target uuid := case when tg_op = 'DELETE' then old.message_id else new.message_id end;
begin
  if was_shown = is_shown then
    return null;
  end if;

  update public.messages
  set clusters_count = greatest(0, clusters_count + case when is_shown then 1 else -1 end)
  where id = target;

  return null;
end;
$$;

revoke execute on function public.count_cluster() from public, anon, authenticated;

-- Без списка колонок: пересчёт меняет и показ, и `deleted_at`.
create trigger on_cluster_counted
  after insert or update or delete on public.fragment_clusters
  for each row execute function public.count_cluster();

-- Уже посчитанные кластеры.
update public.messages m
set clusters_count = s.shown
from (
  select k.message_id, count(*)::int as shown
  from public.fragment_clusters k
  where k.deleted_at is null and k.display_start is not null
  group by k.message_id
) s
where s.message_id = m.id;
