import { useCallback, useMemo, useState, type RefObject } from 'react';
import type { FlatList, View } from 'react-native';

import { contentOf, type BubbleRow, type ChatListRow } from '@/features/chats/islands/rows';
import { createRowRegistry, measureInWindow } from '@/features/chats/rowRegistry';
import type { CommentsLiftHost } from '@/features/interactions/comments/commentsLift';

/**
 * Переписка для шита комментариев: строки на экране (реестр отдаётся списку
 * через `RowRegistryContext`), окно списка и копия облачка строки.
 */
export function useCommentsLiftHost(
  listRef: RefObject<FlatList<ChatListRow> | null>,
  rows: ChatListRow[],
  bubbleContent: (row: BubbleRow, interactive: boolean) => React.ReactElement | null,
) {
  const [registry] = useState(createRowRegistry);

  const measureArea = useCallback(async () => {
    const node = listRef.current?.getNativeScrollRef() as View | null | undefined;
    const rect = await measureInWindow(node);

    return rect ? { top: rect.y, bottom: rect.y + rect.height } : null;
  }, [listRef]);

  const renderRow = useCallback(
    (rowKey: string) => {
      const row = rows.find((candidate) => candidate.key === rowKey);

      if (!row || row.type === 'island-header') return null;

      return bubbleContent(row, false);
    },
    [bubbleContent, rows],
  );

  const hasMedia = useCallback(
    (rowKey: string) => {
      const row = rows.find((candidate) => candidate.key === rowKey);
      const content = row && row.type !== 'island-header' ? contentOf(row) : null;

      return (content?.attachments.length ?? 0) > 0;
    },
    [rows],
  );

  const host = useMemo<CommentsLiftHost>(
    () => ({ measureRow: registry.measure, measureArea, renderRow, hasMedia }),
    [hasMedia, measureArea, registry, renderRow],
  );

  return { registry, host };
}
