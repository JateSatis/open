-- Сообщения с фрагментами этапа 1 появились до модели кластеров — ставим их
-- в очередь пересчёта один раз. Дальше заявки ставят сами взаимодействия.

select public.fragment_clusters_enqueue(m.id)
from public.messages m
where m.fragments_count > 0
  and m.deleted_at is null;
