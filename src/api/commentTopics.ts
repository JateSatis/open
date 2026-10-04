// Каналы Realtime топиков `comments:<message_id>` — по одному на топик на всё
// приложение, как `chatTopics` для чатов.
//
// Топик комментариев сообщения слушают сразу несколько мест: открытая панель
// комментариев и чаты, где лежат пересланные из этой ветки комментарии (их
// правки, удаления и реакции приходят сюда). `supabase.channel()` с тем же
// топиком отдаёт тот же канал, и отписка одного слушателя глушила бы
// остальных, — поэтому канал живёт здесь, со счётчиком слушателей.
//
// Payload любого события — только сигнал: строки перечитываются из базы.

import type { RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '@/api/supabase';

export type CommentTopicListener = {
  /** Появился комментарий; `threadRootId` — тред ответа, `null` — верхнеуровневый. */
  onAdded?: (commentId: string, threadRootId: string | null) => void;
  onDeleted?: (commentId: string, threadRootId: string | null) => void;
  onEdited?: (commentId: string) => void;
  /** Реакции на комментарий изменились — счётчики дочитываются из базы. */
  onReactionsChanged?: (commentId: string) => void;
  /** Сообщение, к которому комментарии, правили или удалили. */
  onTargetChanged?: () => void;
  /** Канал переподключился: пропущенное надо дочитать. */
  onReconnected?: () => void;
};

type Entry = {
  channel: RealtimeChannel;
  listeners: Set<CommentTopicListener>;
  closing: ReturnType<typeof setTimeout> | null;
};

/** Сколько держать канал без слушателей — переход между экранами берёт его снова (см. `chatTopics`). */
const LINGER_MS = 3000;

const topics = new Map<string, Entry>();

function stringField(payload: unknown, field: string): string | null {
  const value = (payload as Record<string, unknown> | undefined)?.[field];

  return typeof value === 'string' ? value : null;
}

function open(messageId: string): Entry {
  void supabase.realtime.setAuth();

  const channel = supabase.channel(`comments:${messageId}`, { config: { private: true } });
  const entry: Entry = { channel, listeners: new Set(), closing: null };
  const each = (call: (listener: CommentTopicListener) => void) =>
    [...entry.listeners].forEach(call);
  let joinedBefore = false;

  const onComment = (
    event: string,
    handler: (listener: CommentTopicListener, id: string, root: string | null) => void,
  ) =>
    channel.on('broadcast', { event }, ({ payload }) => {
      const id = stringField(payload, 'comment_id');

      if (id) each((listener) => handler(listener, id, stringField(payload, 'thread_root_id')));
    });

  onComment('comment_added', (l, id, root) => l.onAdded?.(id, root));
  onComment('comment_deleted', (l, id, root) => l.onDeleted?.(id, root));
  onComment('comment_edited', (l, id) => l.onEdited?.(id));
  onComment('comment_reactions_changed', (l, id) => l.onReactionsChanged?.(id));

  channel
    .on('broadcast', { event: 'target_changed' }, () => each((l) => l.onTargetChanged?.()))
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;

      if (joinedBefore) each((l) => l.onReconnected?.());

      joinedBefore = true;
    });

  return entry;
}

/**
 * Слушать топик комментариев сообщения. Канал общий: первый слушатель его
 * открывает, последний — отпускает. Отдаёт отписку — её обязательно звать в
 * cleanup.
 */
export function acquireCommentTopic(
  messageId: string,
  listener: CommentTopicListener,
): () => void {
  let entry = topics.get(messageId);

  if (!entry) {
    entry = open(messageId);
    topics.set(messageId, entry);
  }

  if (entry.closing) {
    clearTimeout(entry.closing);
    entry.closing = null;
  }

  entry.listeners.add(listener);

  const current = entry;
  let released = false;

  return () => {
    if (released) return;

    released = true;
    current.listeners.delete(listener);

    if (current.listeners.size > 0 || current.closing) return;

    current.closing = setTimeout(() => {
      current.closing = null;

      if (current.listeners.size > 0) return;

      if (topics.get(messageId) === current) topics.delete(messageId);

      void supabase.removeChannel(current.channel);
    }, LINGER_MS);
  };
}
