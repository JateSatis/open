import { useCallback, useMemo, useState } from 'react';

import { isLocalMessage } from '@/features/chats/messageActions';
import type { ChatMessage } from '@/features/chats/messages/types';

export type MessageSelection = {
  /** Режим выбора включён — есть хоть одно отмеченное сообщение. */
  isActive: boolean;
  /** Отмеченные, в порядке переписки: от старого к новому. */
  selected: ChatMessage[];
  isSelected: (messageId: string) => boolean;
  /** Отмечает первое сообщение и тем включает режим выбора. */
  start: (messageId: string) => void;
  /** Снятие последней отметки выключает режим выбора. */
  toggle: (messageId: string) => void;
  clear: () => void;
};

/**
 * Выбор сообщений на экране чата. Хранятся только id: догрузка истории и
 * новые сообщения выбор не трогают, а удалённое сообщение (его больше нет в
 * списке) тихо из выбора выпадает — и режим выключается, если выпало всё.
 */
export function useMessageSelection(messages: ChatMessage[]): MessageSelection {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());

  const selected = useMemo(() => {
    if (ids.size === 0) return [];

    return messages.filter((message) => ids.has(message.id)).reverse();
  }, [ids, messages]);

  const selectedIds = useMemo(() => new Set(selected.map((message) => message.id)), [selected]);

  const isSelected = useCallback((messageId: string) => selectedIds.has(messageId), [selectedIds]);

  const start = useCallback((messageId: string) => setIds(new Set([messageId])), []);

  const toggle = useCallback(
    (messageId: string) => {
      const message = messages.find((item) => item.id === messageId);

      // Неотправленное выбрать нельзя: у него нет настоящего id, и ни одно
      // действие панели к нему не применимо.
      if (!message || isLocalMessage(message)) return;

      setIds((current) => {
        // Удалённое без нас выпадает и отсюда, чтобы не всплыть обратно.
        const next = new Set([...current].filter((id) => selectedIds.has(id)));

        if (next.has(messageId)) next.delete(messageId);
        else next.add(messageId);

        return next;
      });
    },
    [messages, selectedIds],
  );

  const clear = useCallback(() => setIds(new Set()), []);

  return { isActive: selected.length > 0, selected, isSelected, start, toggle, clear };
}
