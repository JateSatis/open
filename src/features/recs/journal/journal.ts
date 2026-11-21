// Журнал рекомендаций на клиенте: запись события и отправка пачками.
//
// Клиент сообщает только то, чего сервер знать не может (просмотр, звук,
// время на экране); реакции, комментарии, подписки и сообщения база пишет в
// журнал сама. Запись не ждёт сети и не трогает React: событие ложится в
// очередь; при уходе в фон она сразу сохраняется на диск.
// Не дошло — повтор с растущей паузой; принятое и отклонённое сервером
// снимается из очереди.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import { createJournalQueue, type JournalQueue, type QueueStorage } from './queue';

import type { JournalData, JournalSendResult, JournalWireEvent } from '@/api/recJournal';
import { isNetworkError } from '@/lib/network';
import { randomUuid } from '@/lib/uuid';

/** Отказ, который пройдёт сам: нет сети, лимит частоты, сессия обновляется. */
function isRetryable(error: unknown): boolean {
  if (isNetworkError(error)) return true;

  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };

  return (
    code === '42501' ||
    code === 'PGRST301' ||
    code === 'journal_delivery_unavailable' ||
    (typeof message === 'string' && /too many events/.test(message))
  );
}

/** Виды событий клиента — те же, что принимает `rec_record_events`. */
export type JournalKind =
  | 'impression_start'
  | 'impression_progress'
  | 'impression_end'
  | 'channel_opened'
  | 'comments_session'
  | 'chat_session'
  | 'media_view'
  | 'voice_play'
  | 'reaction_picker'
  | 'forward_picker'
  | 'search_query'
  | 'search_result_opened'
  | 'app_session_start'
  | 'app_foreground'
  | 'app_background'
  | 'screen_time';

export type JournalSubjectType =
  'pop' | 'message' | 'comment' | 'fragment' | 'channel' | 'chat' | 'profile';

export type JournalSurface =
  'channel' | 'search' | 'feed' | 'chat' | 'comments' | 'profile' | 'app' | 'other';

export type JournalFields = {
  impressionId?: string;
  screenSessionId?: string;
  subject?: { type: JournalSubjectType; id: string };
  surface?: JournalSurface;
  data?: JournalData;
  /** Время события; по умолчанию — сейчас. */
  at?: number;
};

/** Как часто очередь уходит на сервер. */
export const JOURNAL_FLUSH_MS = 5000;
const BACKOFF_MAX_MS = 2 * 60_000;
const QUEUE_MAX_EVENTS = 3000;
/** Сервер не принимает события старше 72 ч. */
const QUEUE_MAX_AGE_MS = 70 * 60 * 60_000;
const STORAGE_KEY = 'rec-journal-queue-v1';
/** Сколько событий принимает `rec_record_events` за вызов. */
const JOURNAL_BATCH_MAX = 100;

export type Journal = {
  log: (kind: JournalKind, fields?: JournalFields) => string | null;
  flush: () => Promise<void>;
  /** Кто сейчас в приложении: события пишутся от его имени. null — никого. */
  setUser: (userId: string | null) => void;
  /** Подтверждённый SDK владелец при доступной связи. */
  setDeliveryUser: (userId: string | null) => void;
  showFirstScreen: () => void;
  setAppSession: (appSessionId: string | null) => void;
  appSessionId: () => string | null;
  /** Ушли в фон — сохранить сейчас. */
  persist: () => Promise<void>;
  /** Сеть вернулась или приложение снова на экране — не ждать паузы повтора. */
  kick: () => void;
  queue: JournalQueue;
};

export function createJournal({
  storage,
  send,
  now = Date.now,
}: {
  storage: QueueStorage;
  send: (events: JournalWireEvent[]) => Promise<JournalSendResult>;
  now?: () => number;
}): Journal {
  const queue = createJournalQueue({
    storage,
    key: STORAGE_KEY,
    maxEvents: QUEUE_MAX_EVENTS,
    maxAgeMs: QUEUE_MAX_AGE_MS,
    now,
  });
  let userId: string | null = null;
  let deliveryUser: string | null = null;
  let screenShown = false;
  let appSession: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sending = false;
  let failures = 0;
  const canSend = (owner: string | null) =>
    !!owner && screenShown && owner === userId && owner === deliveryUser;

  const schedule = (delay: number) => {
    if (timer || sending || !canSend(userId)) return;

    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delay);
  };

  /** Принятое и отклонённое сервером — из очереди; неназванное — повторим позже. */
  const settle = (batch: JournalWireEvent[], result: JournalSendResult) => {
    if (__DEV__ && result.rejected.length > 0) {
      console.warn('rec_record_events rejected:', result.rejected);
    }

    const done = [...result.accepted, ...result.rejected.map((item) => item.id)];
    const doneSet = new Set(done);

    queue.ack(done);
    queue.release(batch.map((event) => event.id).filter((id) => !doneSet.has(id)));

    return done.length;
  };

  /**
   * Отправить пачку. Сеть, лимит частоты, сессия — повторить позже. Иной отказ
   * всей пачки значит, что её ломает одно событие (база не приняла его как
   * json): пачка делится пополам, пока виноватое не останется одно — оно
   * выбрасывается, остальное уходит. Иначе одно событие держало бы очередь.
   */
  async function deliver(batch: JournalWireEvent[]): Promise<'sent' | 'retry'> {
    const ids = batch.map((event) => event.id);
    if (!canSend(batch[0].user_id)) {
      queue.release(ids);
      return 'retry';
    }
    try {
      settle(batch, await send(batch));
      return 'sent';
    } catch (error) {
      if (!canSend(batch[0].user_id) || isRetryable(error)) {
        queue.release(ids);
        return 'retry';
      }

      if (batch.length === 1) {
        if (__DEV__) console.warn('rec_record_events dropped an event:', batch[0].kind, error);
        queue.ack([batch[0].id]);
        return 'sent';
      }

      const half = Math.ceil(batch.length / 2);

      if ((await deliver(batch.slice(0, half))) === 'retry') {
        queue.release(batch.slice(half).map((event) => event.id));
        return 'retry';
      }

      return deliver(batch.slice(half));
    }
  }

  async function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    const owner = userId;
    if (sending || !owner || !canSend(owner)) return;
    sending = true;
    let delay = JOURNAL_FLUSH_MS;
    try {
      await queue.load();
      while (canSend(owner)) {
        const batch = queue.take(owner, JOURNAL_BATCH_MAX);

        if (batch.length === 0) break;

        const before = queue.size(owner);

        if ((await deliver(batch)) === 'retry') {
          if (canSend(owner)) {
            failures += 1;
            delay = Math.min(JOURNAL_FLUSH_MS * 2 ** failures, BACKOFF_MAX_MS);
          }
          break;
        }

        failures = 0;

        // Сервер ничего не назвал — не крутиться на месте.
        if (queue.size(owner) >= before) break;
      }
    } finally {
      sending = false;
    }

    if (userId && queue.size(userId) > 0) schedule(userId === owner ? delay : 0);
  }

  const journal: Journal = {
    log(kind, fields = {}) {
      if (!userId) return null;

      const id = randomUuid();
      const event: JournalWireEvent = {
        id,
        kind,
        v: 1,
        ts: fields.at ?? now(),
        user_id: userId,
        data: fields.data ?? {},
      };

      if (appSession) event.app_session_id = appSession;
      if (fields.screenSessionId) event.screen_session_id = fields.screenSessionId;
      if (fields.impressionId) event.impression_id = fields.impressionId;
      if (fields.subject) {
        event.subject_type = fields.subject.type;
        event.subject_id = fields.subject.id;
      }
      if (fields.surface) event.surface = fields.surface;

      queue.push(event);

      // Некоторые события приходят уже после обработчика ухода в фон.
      if (AppState.currentState === 'background') void journal.persist();
      else schedule(JOURNAL_FLUSH_MS);

      return id;
    },

    flush,

    setUser(next) {
      if (next === userId) return;

      userId = next;

      if (next) void queue.load();
      journal.kick();
    },

    setDeliveryUser(next) {
      if (next === deliveryUser) return;
      deliveryUser = next;
      journal.kick();
    },

    showFirstScreen() {
      if (screenShown) return;
      screenShown = true;
      journal.kick();
    },

    setAppSession(next) {
      appSession = next;
    },

    appSessionId: () => appSession,

    kick() {
      failures = 0;
      void flush();
    },

    persist: queue.save,

    queue,
  };

  return journal;
}

/**
 * Журнал приложения — один на процесс. Клиент Supabase — при первой
 * отправке: журнал пишут экраны, которые тесты рисуют без него.
 */
export const journal = createJournal({
  storage: AsyncStorage,
  send: (events) => import('@/api/recJournal').then((api) => api.recordJournalEvents(events)),
});
