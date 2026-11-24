// События людей с кластерами фрагментов (миграция
// `20261024120000_fragment_cluster_events.sql`) — данные для обучения модели
// кластеров. Копятся и уходят пачкой в фоне: вызывающий не ждёт сети, а сбой
// отправки до него не доходит — потерянная пачка не стоит ни повторов, ни
// ошибки на экране. Уход приложения в фон отправляет накопленное сразу:
// таймер в фоне не сработает. Диапазоны — code points, как в базе.

import { requestClient } from '@/api/requestClient';
import type { AccountClient } from '@/api/accountClient';
import { AppState } from 'react-native';


/** Сколько событий принимает `record_fragment_cluster_events` за вызов. */
export const MAX_EVENTS_BATCH = 50;

/** Сколько копить события перед отправкой, мс. */
export const EVENTS_FLUSH_DELAY_MS = 3000;

export type ClusterEventKind =
  | 'clusters_shown'
  | 'cluster_opened'
  | 'cluster_reacted'
  | 'cluster_commented'
  | 'area_opened';

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

const queued = new Map<AccountClient, ClusterEvent[]>();
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

  const batches = [...queued];
  queued.clear();
  await Promise.all(batches.map(async ([api, events]) => {
    for (let i = 0; i < events.length; i += MAX_EVENTS_BATCH) {
      const batch = events.slice(i, i + MAX_EVENTS_BATCH);

      try {
        const { error } = await api.rpc('record_fragment_cluster_events', { events: batch.map(toRow) });

        // Отказ базы (лимит, неизвестный вид) — сигнал разработчику, не человеку.
        if (error && __DEV__) console.warn('record_fragment_cluster_events:', error);
      } catch {
        // Сеть недоступна — пачка теряется: это данные для обучения, не действие человека.
      }
    }
  }));
}

/** Записать событие: уйдёт с ближайшей пачкой. */
export function trackClusterEvent(event: ClusterEvent, api = requestClient()): void {
  if (!watchingAppState) {
    watchingAppState = true;
    AppState.addEventListener('change', (state) => {
      if (state !== 'active') void flushClusterEvents();
    });
  }

  const queue = queued.get(api) ?? [];
  queue.push(event);
  queued.set(api, queue);

  if (queue.length >= MAX_EVENTS_BATCH) {
    void flushClusterEvents();
    return;
  }

  timer ??= setTimeout(() => {
    void flushClusterEvents();
  }, EVENTS_FLUSH_DELAY_MS);
}
