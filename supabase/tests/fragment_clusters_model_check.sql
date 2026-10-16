-- Кластеры фрагментов: проверка живых данных после пересчёта действующей
-- версией модели. Только чтение.
--   npx supabase db query --linked -f supabase/tests/fragment_clusters_model_check.sql
-- Каждая строка должна быть ok = true; detail — первые нарушители.

with cfg as (
  select max(version) as version from public.fragment_cluster_config
),
msgs as (
  select m.id, m.text, char_length(m.text) as len
  from public.messages m
  where m.fragments_count > 0 and m.deleted_at is null
),
shown as (
  select k.message_id, k.id, k.display_start as s, k.display_end as e, m.text, m.len,
    lag(k.display_end) over (partition by k.message_id order by k.display_start) as prev_end
  from public.fragment_clusters k
  join msgs m on m.id = k.message_id
  where k.deleted_at is null and k.display_start is not null
),
checks as (
  select 'все сообщения с фрагментами пересчитаны действующей версией' as name,
    not exists (
      select 1 from msgs m
      left join public.fragment_cluster_state s on s.message_id = m.id
      where s.model_version is distinct from (select version from cfg)
    ) as ok,
    (select string_agg(m.id::text, ', ') from msgs m
      left join public.fragment_cluster_state s on s.message_id = m.id
      where s.model_version is distinct from (select version from cfg)) as detail
  union all
  select 'живые кластеры — действующей версии',
    not exists (
      select 1 from public.fragment_clusters k join msgs m on m.id = k.message_id
      where k.deleted_at is null and k.model_version <> (select version from cfg)
    ),
    null
  union all
  select 'у сообщения с видимыми фрагментами есть отображаемый',
    not exists (select 1 from msgs m where not exists (select 1 from shown x where x.message_id = m.id)),
    (select string_agg(m.id::text, ', ') from msgs m where not exists (select 1 from shown x where x.message_id = m.id))
  union all
  select 'отображаемые не пересекаются',
    not exists (select 1 from shown where prev_end > s),
    (select string_agg(id::text, ', ') from shown where prev_end > s)
  union all
  select 'отображаемые не длиннее 200 и внутри текста',
    not exists (select 1 from shown where e - s > 200 or s < 0 or e > len),
    (select string_agg(id::text, ', ') from shown where e - s > 200 or s < 0 or e > len)
  union all
  select 'отображаемые — по целым словам',
    not exists (
      select 1 from shown
      where substr(text, s + 1, 1) ~ '\s'
         or (s > 0 and substr(text, s, 1) !~ '\s')
         or substr(text, e, 1) ~ '\s'
         -- Слово длиннее 200 режется по лимиту.
         or (e < len and substr(text, e + 1, 1) !~ '\s' and e - s < 200)
    ),
    (select string_agg(id::text, ', ') from shown
      where substr(text, s + 1, 1) ~ '\s' or (s > 0 and substr(text, s, 1) !~ '\s')
         or substr(text, e, 1) ~ '\s' or (e < len and substr(text, e + 1, 1) !~ '\s' and e - s < 200))
  union all
  select 'у отображаемых есть снимок решения',
    not exists (select 1 from shown x join public.fragment_clusters k on k.id = x.id where k.decision_id is null),
    null
  union all
  select 'все видимые фрагменты привязаны к живому кластеру',
    not exists (
      select 1 from public.message_fragments f join msgs m on m.id = f.message_id
      left join public.fragment_clusters k on k.id = f.cluster_id and k.deleted_at is null
      where f.deleted_at is null and f.anchor_state <> 'lost' and k.id is null
    ),
    null
)
select name, ok, detail, (select count(*) from msgs) as messages, (select count(*) from shown) as displayed
from checks;
