// Каналы Realtime топиков `pops:<channel_id>` — по одному на топик на всё
// приложение, как `chatTopics.ts`: топик канала слушают сразу сетка попсов и
// просмотр поверх неё, а `supabase.channel()` с тем же топиком отдаёт тот же
// экземпляр — отписка одного глушила бы другого.
//
// Payload — только сигнал: счётчики всегда перечитываются из базы.

import { perClient } from './perClient';

import { requestClient } from '@/api/requestClient';
import type { AccountClient } from '@/api/accountClient';
import type { RealtimeChannel } from '@supabase/supabase-js';


export type PopTopicListener = {
  /** У попа сменились реакции. */
  onReactionsChanged?: (popId: string) => void;
  /** У попа изменилось число комментариев. */
  onCommentsChanged?: (popId: string) => void;
  /** У этих попсов выросли просмотры. */
  onViewsChanged?: (popIds: string[]) => void;
  /** Канал заново подключился: пропущенное за время обрыва пора дочитать. */
  onReconnected?: () => void;
};

type Entry = {
  channel: RealtimeChannel;
  listeners: Set<PopTopicListener>;
  closing: ReturnType<typeof setTimeout> | null;
};

/** Сколько держать канал без слушателей: переход между экранами отпускает и тут же берёт снова. */
const LINGER_MS = 3000;

const clientTopics = perClient(() => new Map<string, Entry>());

function popIdOf(payload: unknown): string | null {
  const id = (payload as { pop_id?: unknown } | undefined)?.pop_id;

  return typeof id === 'string' ? id : null;
}

function popIdsOf(payload: unknown): string[] {
  const ids = (payload as { pop_ids?: unknown } | undefined)?.pop_ids;

  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

function open(channelId: string, api: AccountClient): Entry {
  // Приватный канал несёт токен пользователя — его проверяют политики realtime.messages.
  void api.realtime.setAuth().catch(() => undefined);

  const channel = api.channel(`pops:${channelId}`, { config: { private: true } });
  const entry: Entry = { channel, listeners: new Set(), closing: null };
  const each = (call: (listener: PopTopicListener) => void) => api === requestClient() && [...entry.listeners].forEach(call);
  let joinedBefore = false;

  channel
    .on('broadcast', { event: 'pop_reactions_changed' }, ({ payload }) => {
      const id = popIdOf(payload);

      if (id) each((l) => l.onReactionsChanged?.(id));
    })
    .on('broadcast', { event: 'pop_comments_changed' }, ({ payload }) => {
      const id = popIdOf(payload);

      if (id) each((l) => l.onCommentsChanged?.(id));
    })
    .on('broadcast', { event: 'pop_views_changed' }, ({ payload }) => {
      const list = popIdsOf(payload);

      if (list.length > 0) each((l) => l.onViewsChanged?.(list));
    })
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;

      if (joinedBefore) each((l) => l.onReconnected?.());

      joinedBefore = true;
    });

  return entry;
}

/**
 * Слушать топик попсов канала. Первый слушатель открывает канал, последний —
 * отпускает. Вызвавший обязан вызвать возвращённую функцию в cleanup.
 */
export function acquirePopTopic(channelId: string, listener: PopTopicListener, api = requestClient()): () => void {
  const topics = clientTopics(api);
  let entry = topics.get(channelId);

  if (!entry) {
    entry = open(channelId, api);
    topics.set(channelId, entry);
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

      if (topics.get(channelId) === current) topics.delete(channelId);

      void api.removeChannel(current.channel);
    }, LINGER_MS);
  };
}
