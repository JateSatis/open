import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { FlatList } from 'react-native';

import type { CommentItem } from '@/features/interactions/comments/commentItem';
import { showNotice } from '@/features/notifications/alertsStore';

/** Глубже стольких страниц за цитатой не идём: дальше дешевле сказать «не найден». */
const MAX_PAGES = 20;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Прыжок к процитированному комментарию: если его ещё нет в списке —
 * догружаем страницы старее, пока не найдём, потом прокручиваем к нему и
 * подсвечиваем, как прыжок к сообщению в переписке.
 */
export function useJumpToComment(
  listRef: RefObject<FlatList<CommentItem> | null>,
  comments: CommentItem[],
  hasMore: boolean,
  loadMore: () => Promise<void>,
) {
  const [highlight, setHighlight] = useState<{ id: string; key: number } | null>(null);
  const latest = useRef({ comments, hasMore });

  useEffect(() => {
    latest.current = { comments, hasMore };
  }, [comments, hasMore]);

  const jump = useCallback(
    async (commentId: string) => {
      for (let page = 0; page <= MAX_PAGES; page += 1) {
        const index = latest.current.comments.findIndex((item) => item.id === commentId);

        if (index !== -1) {
          listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
          setHighlight({ id: commentId, key: Date.now() });
          return;
        }

        if (!latest.current.hasMore) break;

        await loadMore();
        // Догруженное попадает в список после перерисовки.
        await nextFrame();
        await nextFrame();
      }

      showNotice('Не удалось найти комментарий', 'error');
    },
    [listRef, loadMore],
  );

  return { jump, highlight };
}
