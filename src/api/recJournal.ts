// Журнал рекомендаций (миграции `20261026*_rec_journal_*.sql`): приём пачки
// событий клиента. Дубли сервер принимает молча, мусор — отклоняет с
// причиной; и то и другое клиент снимает из очереди.

import { requestClient } from '@/api/requestClient';
import { isCurrentSession } from '@/features/auth/sessionOwner';
import { getConnectionStatus } from '@/features/connection/connectionStore';
import { sessionAuthorization } from './sessionAuthorization';
import type { Json } from '@/api/types.gen';

/** Сколько событий принимает `rec_record_events` за вызов (`batchMax` в `rec_config`). */
export const JOURNAL_BATCH_MAX = 100;

/** Поля события сверх горячих — компактный `data` в базе. */
export type JournalData = { [key: string]: Json | undefined };

/** Событие в форме, которую принимает база. Время — миллисекунды эпохи по часам телефона. */
export type JournalWireEvent = {
  id: string;
  kind: string;
  v: 1;
  ts: number;
  user_id: string;
  app_session_id?: string;
  screen_session_id?: string;
  impression_id?: string;
  subject_type?: string;
  subject_id?: string;
  surface?: string;
  data: JournalData;
};

export type JournalSendResult = {
  accepted: string[];
  rejected: { id: string; reason: string }[];
};

function isResult(value: unknown): value is JournalSendResult {
  if (!value || typeof value !== 'object') return false;

  const { accepted, rejected } = value as Partial<JournalSendResult>;

  return Array.isArray(accepted) && Array.isArray(rejected);
}

/**
 * Отправить пачку. Отказ целиком (лимит частоты, сеть) — исключение:
 * очередь подождёт и повторит.
 */
export async function recordJournalEvents(events: JournalWireEvent[], api = requestClient()): Promise<JournalSendResult> {
  if (events.length === 0) return { accepted: [], rejected: [] };

  const owner = api.sessionOwner?.();
  if (!owner || events.some((event) => event.user_id !== owner.userId)) {
    throw deliveryUnavailable();
  }
  // Обновление токена или смена аккаунта во время подготовки RPC не должны
  // превратить временный отказ авторизации в окончательное отклонение пачки.
  const authorization = await sessionAuthorization(owner, api).catch((cause: unknown) => {
    throw deliveryUnavailable(cause);
  });
  if (!isCurrentSession(owner) || getConnectionStatus() !== 'online') throw deliveryUnavailable();
  const { data, error } = await api
    .rpc('rec_record_events', {
      batch: { sent_at: Date.now(), events: events.slice(0, JOURNAL_BATCH_MAX) },
    })
    .setHeader('Authorization', authorization);

  if (error) throw error;
  if (!isResult(data)) throw new Error('rec_record_events: unexpected response');

  return data;
}

function deliveryUnavailable(cause?: unknown) {
  return Object.assign(new Error('Journal delivery unavailable'), {
    code: 'journal_delivery_unavailable',
    cause,
  });
}
