import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import type { ChatThreadPaneRow } from '@/features/chats/chatThreads/useChatThreadPane';
import type { JumpHighlight } from '@/features/chats/useJumpToMessage';
import { PENDING_SEQ } from '@/api/pendingSeq';

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
  const atEnd = useRef(false);
  const followOwn = useRef(false);
  const lastKey = useRef<string | null>(null);
  const last = rows[rows.length - 1];
  useEffect(() => {
    const changed = lastKey.current !== last?.key;
    lastKey.current = last?.key ?? null;
    if (!changed || last?.type !== 'message' || last.message.seq < PENDING_SEQ) return;
    followOwn.current = true;
    const frame = requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
    return () => cancelAnimationFrame(frame);
  }, [last, listRef]);

  const onScroll = useCallback(({ nativeEvent: event }: NativeSyntheticEvent<NativeScrollEvent>) => {
    atEnd.current = event.contentOffset.y + event.layoutMeasurement.height >= event.contentSize.height - 24;
  }, []);
  const onContentSizeChange = useCallback(() => {
    if (!followOwn.current && !atEnd.current) return;
    followOwn.current = false;
    listRef.current?.scrollToEnd({ animated: false });
  }, [listRef]);

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

  return { highlight, jumpInPane, onScrollToIndexFailed, onScroll, onContentSizeChange };
}
