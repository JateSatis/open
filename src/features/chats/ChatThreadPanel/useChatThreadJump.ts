import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { FlatList } from 'react-native';

import type { ChatThreadPaneRow } from '@/features/chats/chatThreads/useChatThreadPane';
import type { JumpHighlight } from '@/features/chats/useJumpToMessage';

type Options = {
  listRef: RefObject<FlatList<ChatThreadPaneRow> | null>;
  rows: ChatThreadPaneRow[];
  /** Догрузить разрыв треда до сообщения с этим номером. */
  loadUntil: (seq: number) => Promise<boolean>;
  isLoading: boolean;
  /** К чему прокрутить при открытии (`'end'` — конец треда). */
  focusMessageId?: string | 'end';
};

/**
 * Переходы внутри шторки: по цитате — к сообщению треда с подсветкой (через
 * разрыв, если оно в нём), при открытии — к нужному месту. Цель — в ref:
 * после догрузки строка появляется на следующей отрисовке.
 */
export function useChatThreadJump({ listRef, rows, loadUntil, isLoading, focusMessageId }: Options) {
  const [highlight, setHighlight] = useState<JumpHighlight | null>(null);
  const [jumps, setJumps] = useState(0);
  const targetRef = useRef<string | null>(null);
  const focused = useRef(false);

  useEffect(() => {
    const target = targetRef.current;
    const index = target ? rows.findIndex((row) => row.key === target) : -1;

    if (index === -1) return;

    targetRef.current = null;
    listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
  }, [jumps, listRef, rows]);

  const jumpInPane = useCallback(
    async (messageId: string, seq: number) => {
      if (!(await loadUntil(seq))) return;

      targetRef.current = messageId;
      setJumps((count) => count + 1);
      setHighlight({ messageId, key: Date.now() });
    },
    [loadUntil],
  );

  // Мой ответ из всплывашки — в конце треда: туда и прокрутить.
  useEffect(() => {
    if (focused.current || isLoading || !focusMessageId) return;

    focused.current = true;

    const index =
      focusMessageId === 'end' ? -1 : rows.findIndex((row) => row.key === focusMessageId);

    requestAnimationFrame(() => {
      if (index === -1) listRef.current?.scrollToEnd({ animated: false });
      else listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
    });
  }, [focusMessageId, isLoading, listRef, rows]);

  /** Строки разной высоты: к далёкой — сначала примерно, потом точно. */
  const onScrollToIndexFailed = useCallback(
    ({ index, averageItemLength }: { index: number; averageItemLength: number }) => {
      listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });
      setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.5 }), 120);
    },
    [listRef],
  );

  return { highlight, jumpInPane, onScrollToIndexFailed };
}
