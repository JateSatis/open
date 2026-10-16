-- Кластеры фрагментов, этап 3а: модель версии 2 — карта популярности.
--
-- Склейка фрагментов цепочкой и два прохода заменены картой популярности
-- (слои людей) и моделью рельефа: горы, значимые впадины, варианты подсветки
-- ватерлинией и точный выбор набора (supabase/functions/_shared/
-- popularityMap.ts, reliefModel.ts). Параметры — новой строкой конфигурации;
-- числа функции оценки — стартовые коэффициенты, не пороги-правила.
--
-- Все сообщения с фрагментами ставятся в очередь пересчёта версией 2 — как
-- в 20261023110000_fragment_clusters_backfill.sql. Обработчик с новой
-- моделью должен быть развёрнут до этой миграции, иначе старый код посчитал
-- бы сообщения под номером версии 2.

insert into public.fragment_cluster_config (version, params, note) values (
  2,
  jsonb_build_object(
    -- Карта: вес слоя человека в точке.
    'weightReaction', 1,
    'weightComment', 1.5,
    -- Впадина делит горы при z ≥ significanceZ (пуассоновские голоса);
    -- рябь рельефа расширяет дисперсию.
    'significanceZ', 2,
    'noiseInflation', 2,
    -- Стартовые коэффициенты функции оценки варианта.
    'weightThickness', 1,
    'weightCapture', 0.25,
    'weightPrecision', 0,
    'weightLength', 0.8,
    'lengthPeople', 5,
    'lengthSpreadMin', 0.7,
    'weightCoverage', 0.3,
    'stableBonus', 0.15,
    -- Набор отображаемых.
    'maxDisplayLength', 200,
    'slotChars', 100,
    'maxDisplayed', 8,
    'densityPenalty', 0.6,
    'densityRadius', 120,
    'clutterCost', 0.1,
    -- Журнал решений.
    'decisionCandidates', 3,
    'decisionBasins', 50,
    'decisionEvery', 20,
    'historyRetentionDays', 180,
    -- События людей с кластерами: пачка, частота на человека, повтор показа.
    'eventsBatchMax', 50,
    'eventsPerMinute', 300,
    'shownDedupSeconds', 30,
    -- Очередь — как в версии 1.
    'eagerInteractions', 20,
    'thresholdDoublings', 2,
    'thresholdStep', 100,
    'staleInteractions', 10,
    'leaseSeconds', 30
  ),
  'Этап 3а: карта популярности и модель рельефа'
);

select public.fragment_clusters_enqueue(m.id)
from public.messages m
where m.fragments_count > 0
  and m.deleted_at is null;
