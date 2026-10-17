// Журнал рекомендаций на клиенте: запись события и отправка пачками.
//
// Клиент сообщает только то, чего сервер знать не может (просмотр, звук,
// время на экране); реакции, комментарии, подписки и сообщения база пишет в
// журнал сама. Запись не ждёт сети и не трогает React: событие ложится в
// очередь, очередь уходит раз в несколько секунд, при уходе в фон — сразу.
// Не дошло — повтор с растущей паузой; принятое и отклонённое сервером
// снимается из очереди.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import { createJournalQueue, type JournalQueue, type QueueStorage } from './queue';

import type { JournalData, JournalSendResult, JournalWireEvent } from '@/api/recJournal';
import { randomUuid } from '@/lib/uuid';

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
  | 'pop'
  | 'message'
  | 'comment'
  | 'fragment'
  | 'channel'
  | 'chat'
  | 'profile';

export type JournalSurface =
  | 'channel'
  | 'search'
  | 'feed'
  | 'chat'
  | 'comments'
  | 'profile'
  | 'app'
  | 'other';

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
  setAppSession: (appSessionId: string | null) => void;
  appSessionId: () => string | null;
  /** Ушли в фон — отправить и сохранить сейчас. */
  persist: () => Promise<void>;
  queue: JournalQueue;
};

export function createJournal({
  storage,
  send,
  now = Date.now,
  watchAppState = true,
}: {
  storage: QueueStorage;
  send: (events: JournalWireEvent[]) => Promise<JournalSendResult>;
  now?: () => number;
  watchAppState?: boolean;
}): Journal {
  const queue = createJournalQueue({
    storage,
    key: STORAGE_KEY,
    maxEvents: QUEUE_MAX_EVENTS,
    maxAgeMs: QUEUE_MAX_AGE_MS,
    now,
  });
  let userId: string | null = null;
  let appSession: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sending = false;
  let failures = 0;
  let loaded: Promise<void> | null = null;

  const ensureLoaded = () => {
    loaded ??= queue.load();

    return loaded;
  };

  const schedule = (delay: number) => {
    if (timer) return;

    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delay);
  };

  async function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    await ensureLoaded();

    if (sending || !userId) return;

    sending = true;

    try {
      for (;;) {
        const batch = queue.take(userId, JOURNAL_BATCH_MAX);

        if (batch.length === 0) break;

        let result: JournalSendResult;

        try {
          result = await send(batch);
        } catch {
          queue.release(batch.map((event) => event.id));
          failures += 1;
          schedule(Math.min(JOURNAL_FLUSH_MS * 2 ** failures, BACKOFF_MAX_MS));
          return;
        }

        failures = 0;

        if (__DEV__ && result.rejected.length > 0) {
          console.warn('rec_record_events rejected:', result.rejected);
        }

        const done = [...result.accepted, ...result.rejected.map((item) => item.id)];
        const doneSet = new Set(done);

        queue.ack(done);
        // Чего сервер не назвал ни принятым, ни отклонённым — повторим позже.
        queue.release(batch.map((event) => event.id).filter((id) => !doneSet.has(id)));

        if (done.length === 0) break;
      }
    } finally {
      sending = false;
    }

    if (userId && queue.size(userId) > 0 && failures === 0) schedule(JOURNAL_FLUSH_MS);
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

      // В фоне таймер может не дожить: конец показа и уход в фон пишутся уже
      // после события AppState — отправить и сохранить сразу.
      if (watchAppState && AppState.currentState === 'background') void journal.persist();
      else schedule(JOURNAL_FLUSH_MS);

      return id;
    },

    flush,

    setUser(next) {
      if (next === userId) return;

      userId = next;

      if (next) {
        void ensureLoaded().then(() => {
          if (queue.size(next) > 0) schedule(0);
        });
      }
    },

    setAppSession(next) {
      appSession = next;
    },

    appSessionId: () => appSession,

    async persist() {
      await queue.save();
      await flush();
      await queue.save();
    },

    queue,
  };

  if (watchAppState) {
    AppState.addEventListener('change', (state) => {
      if (state === 'background') void journal.persist();
    });
  }

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
