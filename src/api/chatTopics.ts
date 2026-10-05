// Каналы Realtime топиков `chat:<id>` — по одному на топик на всё приложение.
//
// `supabase.channel(topic)` с тем же топиком отдаёт тот же экземпляр канала:
// второй подписчик не получает своего, а отписка любого глушит всех. Топик
// чата слушают сразу несколько мест — открытый экран чата, островки других
// чатов, где стоят его сообщения, второй экран того же чата ниже в стеке, —
// поэтому канал живёт здесь, со счётчиком слушателей, и закрывается, только
// когда ушёл последний.
//
// Payload любого события — только сигнал: строки всегда перечитываются из
// базы, где видимость решает RLS.

import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '@/api/supabase';

/** Что человек делает прямо сейчас — для «печатает…» и «записывает голосовое…». */
export type ChatActivity = 'typing' | 'recording_voice';

export type ChatTopicListener = {
  onMessage?: () => void;
  onRead?: () => void;
  onMembersChanged?: () => void;
  onMessagesDeleted?: (messageIds: string[]) => void;
  onMessageEdited?: (messageId: string) => void;
  onPinsChanged?: () => void;
  onReactionsChanged?: (messageId: string) => void;
  onCommentsChanged?: (messageId: string) => void;
  /** У этих сообщений выросли просмотры или появилось «прочитано». */
  onViewsChanged?: (messageIds: string[]) => void;
  onStreamChanged?: () => void;
  /** Из островка этого чата убрали сообщения. */
  onForwardChanged?: (forwardId: string) => void;
  onTyping?: (userId: string, activity: ChatActivity) => void;
  /** Канал заново подключился: пропущенное за время обрыва пора дочитать. */
  onReconnected?: () => void;
};

export type ChatTopic = {
  broadcastTyping: (userId: string, activity: ChatActivity) => void;
  release: () => void;
};

type Entry = {
  channel: RealtimeChannel;
  listeners: Set<ChatTopicListener>;
  /** Ушёл последний слушатель — канал ещё немного живёт, вдруг вернутся. */
  closing: ReturnType<typeof setTimeout> | null;
};

/**
 * Сколько держать канал без слушателей. Переход между экранами отпускает
 * топик и тут же берёт снова — закрывать и открывать канал на каждом таком
 * переходе незачем, а закрывающийся канал `supabase.channel()` отдал бы
 * повторно, уже неживым.
 */
const LINGER_MS = 3000;

const topics = new Map<string, Entry>();

function messageIdOf(payload: unknown): string | null {
  const id = (payload as { message_id?: unknown } | undefined)?.message_id;

  return typeof id === 'string' ? id : null;
}

function messageIdsOf(payload: unknown): string[] {
  const ids = (payload as { message_ids?: unknown } | undefined)?.message_ids;

  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

function toActivity(value: unknown): ChatActivity {
  return value === 'recording_voice' ? value : 'typing';
}

function open(chatId: string): Entry {
  // Private channels carry the user's token, which is what the policies on
  // realtime.messages check; without this the subscription is rejected.
  void supabase.realtime.setAuth();

  const channel = supabase.channel(`chat:${chatId}`, { config: { private: true } });
  const entry: Entry = { channel, listeners: new Set(), closing: null };
  const each = (call: (listener: ChatTopicListener) => void) =>
    [...entry.listeners].forEach(call);
  let joinedBefore = false;

  channel
    .on('broadcast', { event: 'new_message' }, () => each((l) => l.onMessage?.()))
    .on('broadcast', { event: 'read' }, () => each((l) => l.onRead?.()))
    .on('broadcast', { event: 'member_joined' }, () => each((l) => l.onMembersChanged?.()))
    .on('broadcast', { event: 'messages_deleted' }, ({ payload }) => {
      const list = messageIdsOf(payload);

      each((l) => l.onMessagesDeleted?.(list));
    })
    .on('broadcast', { event: 'message_edited' }, ({ payload }) => {
      const id = messageIdOf(payload);

      if (id) each((l) => l.onMessageEdited?.(id));
    })
    .on('broadcast', { event: 'pins_changed' }, () => each((l) => l.onPinsChanged?.()))
    .on('broadcast', { event: 'reactions_changed' }, ({ payload }) => {
      const id = messageIdOf(payload);

      if (id) each((l) => l.onReactionsChanged?.(id));
    })
    .on('broadcast', { event: 'comments_changed' }, ({ payload }) => {
      const id = messageIdOf(payload);

      if (id) each((l) => l.onCommentsChanged?.(id));
    })
    .on('broadcast', { event: 'views_changed' }, ({ payload }) => {
      const list = messageIdsOf(payload);

      if (list.length > 0) each((l) => l.onViewsChanged?.(list));
    })
    .on('broadcast', { event: 'forward_changed' }, ({ payload }) => {
      const id = messageIdOf(payload);

      if (id) each((l) => l.onForwardChanged?.(id));
    })
    .on('broadcast', { event: 'stream_changed' }, () => each((l) => l.onStreamChanged?.()))
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      const { userId, activity } = (payload ?? {}) as { userId?: unknown; activity?: unknown };

      // Событие без `activity` — от версии приложения до голосовых: это набор текста.
      if (typeof userId === 'string') each((l) => l.onTyping?.(userId, toActivity(activity)));
    })
    .subscribe((status) => {
      // Первая подписка — не переподключение: историю в этот момент грузит
      // сам экран, и дочитывать нечего. Любая следующая — после обрыва, и
      // флаг при ошибке не сбрасывается: иначе повторное подключение
      // выглядело бы первым и пропущенное так и осталось бы пропущенным.
      if (status !== 'SUBSCRIBED') return;

      if (joinedBefore) each((l) => l.onReconnected?.());

      joinedBefore = true;
    });

  return entry;
}

/**
 * Слушать топик чата. Канал общий: первый слушатель его открывает,
 * последний — отпускает. Вызвавший обязан вызвать `release` в cleanup.
 */
export function acquireChatTopic(chatId: string, listener: ChatTopicListener): ChatTopic {
  let entry = topics.get(chatId);

  if (!entry) {
    entry = open(chatId);
    topics.set(chatId, entry);
  }

  if (entry.closing) {
    clearTimeout(entry.closing);
    entry.closing = null;
  }

  entry.listeners.add(listener);

  const current = entry;
  let released = false;

  return {
    broadcastTyping: (userId, activity) => {
      void current.channel.send({
        type: 'broadcast',
        event: 'typing',
        payload: { userId, activity },
      });
    },
    release: () => {
      if (released) return;

      released = true;
      current.listeners.delete(listener);

      if (current.listeners.size > 0 || current.closing) return;

      current.closing = setTimeout(() => {
        current.closing = null;

        if (current.listeners.size > 0) return;

        if (topics.get(chatId) === current) topics.delete(chatId);

        void supabase.removeChannel(current.channel);
      }, LINGER_MS);
    },
  };
}

