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
//
// У чата два топика: `chat:<id>` слушает любой, `chat-members:<id>` — только
// участники (политики `realtime.messages`). Во второй уходит «печатает» того,
// кто показывает активность только друзьям и пишет в чате, где все остальные
// — его друзья (`my_typing_audience`).

import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '@/api/supabase';

/** Что человек делает прямо сейчас — для «печатает…» и «записывает голосовое…». */
export type ChatActivity = 'typing' | 'recording_voice';

/** Куда слать «печатает»: всем, только участникам или никуда — решает база. */
export type TypingAudience = 'chat' | 'members' | 'none';

export type ChatTopicListener = {
  onMessage?: () => void;
  onRead?: () => void;
  onMembersChanged?: () => void;
  /**
   * Чат изменился: название, фото, описание, состав, заявки — или его
   * удалили. Что именно, подписчик перечитывает из базы.
   */
  onChatChanged?: () => void;
  onMessagesDeleted?: (messageIds: string[]) => void;
  onMessageEdited?: (messageId: string) => void;
  onPinsChanged?: () => void;
  onReactionsChanged?: (messageId: string) => void;
  onCommentsChanged?: (messageId: string) => void;
  /** Пересчёт поменял отображаемые кластеры фрагментов сообщения. */
  onClustersChanged?: (messageId: string) => void;
  /** У этих сообщений выросли просмотры или появилось «прочитано». */
  onViewsChanged?: (messageIds: string[]) => void;
  onStreamChanged?: () => void;
  /**
   * Участник сменил, кому видно время сообщений: время, даты и прочтение в
   * этом чате пора перечитать.
   */
  onTimeVisibilityChanged?: () => void;
  /**
   * Участник сменил, кому видны его имя, фото или имя в диалогах, или взял
   * другой псевдоним: людей у загруженных сообщений и в участниках пора
   * перечитать.
   */
  onPeopleChanged?: () => void;
  /** Из островка этого чата убрали сообщения. */
  onForwardChanged?: (forwardId: string) => void;
  onTyping?: (userId: string, activity: ChatActivity) => void;
  /** Канал заново подключился: пропущенное за время обрыва пора дочитать. */
  onReconnected?: () => void;
};

export type ChatTopic = {
  /** `members` — в топик участников; открыть его может только участник. */
  broadcastTyping: (userId: string, activity: ChatActivity, audience: TypingAudience) => void;
  release: () => void;
};

type Entry = {
  channel: RealtimeChannel;
  /** Топик участников — открывается первым, кто в него пишет или его слушает. */
  members: RealtimeChannel | null;
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

function typingFrom(payload: unknown): { userId: string; activity: ChatActivity } | null {
  const { userId, activity } = (payload ?? {}) as { userId?: unknown; activity?: unknown };

  // Событие без `activity` — от версии приложения до голосовых: это набор текста.
  return typeof userId === 'string' ? { userId, activity: toActivity(activity) } : null;
}

/**
 * Топик участников: «печатает» тех, кто показывает активность только
 * друзьям. Посторонний его не откроет — политика откажет, и канал просто
 * останется молчащим.
 */
function openMembers(chatId: string, entry: Entry): RealtimeChannel {
  const channel = supabase.channel(`chat-members:${chatId}`, { config: { private: true } });

  channel
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      const typing = typingFrom(payload);

      if (typing) [...entry.listeners].forEach((l) => l.onTyping?.(typing.userId, typing.activity));
    })
    .subscribe();

  return channel;
}

function open(chatId: string): Entry {
  // Private channels carry the user's token, which is what the policies on
  // realtime.messages check; without this the subscription is rejected.
  void supabase.realtime.setAuth();

  const channel = supabase.channel(`chat:${chatId}`, { config: { private: true } });
  const entry: Entry = { channel, members: null, listeners: new Set(), closing: null };
  const each = (call: (listener: ChatTopicListener) => void) =>
    [...entry.listeners].forEach(call);
  let joinedBefore = false;

  channel
    .on('broadcast', { event: 'new_message' }, () => each((l) => l.onMessage?.()))
    .on('broadcast', { event: 'read' }, () => each((l) => l.onRead?.()))
    .on('broadcast', { event: 'member_joined' }, () => each((l) => l.onMembersChanged?.()))
    .on('broadcast', { event: 'chat_changed' }, () => each((l) => l.onChatChanged?.()))
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
    .on('broadcast', { event: 'clusters_changed' }, ({ payload }) => {
      const id = messageIdOf(payload);

      if (id) each((l) => l.onClustersChanged?.(id));
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
    .on('broadcast', { event: 'time_visibility_changed' }, () =>
      each((l) => l.onTimeVisibilityChanged?.()),
    )
    .on('broadcast', { event: 'people_changed' }, () => each((l) => l.onPeopleChanged?.()))
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      const typing = typingFrom(payload);

      if (typing) each((l) => l.onTyping?.(typing.userId, typing.activity));
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
 * `asMember` — слушать и топик участников: «печатает» тех, кто показывает
 * его только друзьям.
 */
export function acquireChatTopic(
  chatId: string,
  listener: ChatTopicListener,
  asMember = false,
): ChatTopic {
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

  if (asMember) current.members ??= openMembers(chatId, current);

  return {
    broadcastTyping: (userId, activity, audience) => {
      if (audience === 'none') return;

      const target =
        audience === 'members' ? (current.members ??= openMembers(chatId, current)) : current.channel;

      void target.send({
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
        if (current.members) void supabase.removeChannel(current.members);
      }, LINGER_MS);
    },
  };
}

