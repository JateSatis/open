// События людей с кластерами фрагментов (миграция
// `20261024120000_fragment_cluster_events.sql`) — данные для обучения модели
// кластеров. Копятся и уходят пачкой в фоне: вызывающий не ждёт сети, а сбой
// отправки до него не доходит — потерянная пачка не стоит ни повторов, ни
// ошибки на экране. Уход приложения в фон отправляет накопленное сразу:
// таймер в фоне не сработает. Диапазоны — code points, как в базе.

import { AppState } from 'react-native';

import { supabase } from '@/api/supabase';

/** Сколько событий принимает `record_fragment_cluster_events` за вызов. */
export const MAX_EVENTS_BATCH = 50;

/** Сколько копить события перед отправкой, мс. */
export const EVENTS_FLUSH_DELAY_MS = 3000;

export type ClusterEventKind =
  | 'clusters_shown'
  | 'cluster_opened'
  | 'cluster_reacted'
  | 'cluster_commented'
  | 'area_opened'
  | 'quote_followed';

export type ClusterEvent = {
  kind: ClusterEventKind;
  messageId: string;
  /** Снимок решения, по которому кластеры показаны (`FragmentCluster.decisionId`). */
  decisionId?: string | null;
  clusterId?: string | null;
  fragmentId?: string | null;
  rangeStart?: number;
  rangeEnd?: number;
  detail?: Record<string, number>;
};

let queue: ClusterEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let watchingAppState = false;

function toRow(event: ClusterEvent) {
  return {
    kind: event.kind,
    message_id: event.messageId,
    decision_id: event.decisionId ?? null,
    cluster_id: event.clusterId ?? null,
    fragment_id: event.fragmentId ?? null,
    range_start: event.rangeStart ?? null,
    range_end: event.rangeEnd ?? null,
    detail: event.detail ?? {},
  };
}

/** Отправить накопленное сейчас. Не бросает. */
export async function flushClusterEvents(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  while (queue.length > 0) {
    const batch = queue.slice(0, MAX_EVENTS_BATCH);

    queue = queue.slice(MAX_EVENTS_BATCH);

    try {
      const { error } = await supabase.rpc('record_fragment_cluster_events', { events: batch.map(toRow) });

      // Отказ базы (лимит, неизвестный вид) — сигнал разработчику, не человеку.
      if (error && __DEV__) console.warn('record_fragment_cluster_events:', error);
    } catch {
      // Сеть недоступна — пачка теряется: это данные для обучения, не действие человека.
    }
  }
}

/** Записать событие: уйдёт с ближайшей пачкой. */
export function trackClusterEvent(event: ClusterEvent): void {
  if (!watchingAppState) {
    watchingAppState = true;
    AppState.addEventListener('change', (state) => {
      if (state !== 'active') void flushClusterEvents();
    });
  }

  queue.push(event);

  if (queue.length >= MAX_EVENTS_BATCH) {
    void flushClusterEvents();
    return;
  }

  timer ??= setTimeout(() => {
    void flushClusterEvents();
  }, EVENTS_FLUSH_DELAY_MS);
}
