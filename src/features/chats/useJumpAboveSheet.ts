import { useCallback, useState, type RefObject } from 'react';
import type { FlatList, View } from 'react-native';

import type { ChatListRow } from '@/features/chats/islands/rows';
import type { JumpToMessage } from '@/features/chats/useJumpToMessage';
import {
  getCommentsPanelTarget,
  useCommentsPanelTarget,
  waitPanelRestTop,
  type CommentsPanelTarget,
} from '@/features/interactions/comments/commentsPanelStore';

/** Шит встаёт, когда замерена его шапка с сообщением, — на чужом чате после загрузки. */
const REST_WAIT_MS = 2000;
/** Замер списка приходит в следующем кадре; дольше — значит, его не будет. */
const MEASURE_WAIT_MS = 300;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Низ окна списка в координатах окна; `null` — не замерить. */
function bottomOf(listRef: RefObject<FlatList<ChatListRow> | null>): Promise<number | null> {
  const node = listRef.current?.getNativeScrollRef() as View | null | undefined;

  if (!node?.measureInWindow) return Promise.resolve(null);

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), MEASURE_WAIT_MS);

    node.measureInWindow((_x, y, _width, height) => {
      clearTimeout(timer);
      resolve(y + height);
    });
  });
}

/**
 * Прыжок к сообщению под шитом комментариев: строка встаёт по центру того,
 * что видно над шитом в среднем положении, а не по центру экрана, где её
 * закрыл бы шит. Последние сообщения так высоко не поднять — для них внизу
 * переписки, под шитом, появляется отступ на высоту шита. Он живёт, пока шит
 * открыт: закрыли — переписка опускается, сообщение остаётся на экране.
 */
export function useJumpAboveSheet(
  listRef: RefObject<FlatList<ChatListRow> | null>,
  jump: JumpToMessage['jump'],
) {
  // Отступ принадлежит той панели, ради которой прыгали: её закрыли или
  // открыли другую — отступа нет.
  const [placed, setPlaced] = useState<{ panel: CommentsPanelTarget; inset: number } | null>(null);
  const panel = useCommentsPanelTarget();
  const inset = placed && placed.panel === panel ? placed.inset : 0;

  const jumpAboveSheet = useCallback(
    async (rowKey: string, createdAt: string) => {
      const [restTop, listBottom] = await Promise.all([
        waitPanelRestTop(REST_WAIT_MS),
        bottomOf(listRef),
      ]);
      const covered =
        restTop !== null && listBottom !== null ? Math.max(0, Math.round(listBottom - restTop)) : 0;

      const opened = getCommentsPanelTarget();

      if (!opened) return false;

      // Отступ — до прокрутки: список должен успеть его разложить.
      setPlaced({ panel: opened, inset: covered });
      await nextFrame();
      await nextFrame();

      return jump(rowKey, createdAt, { inset: covered });
    },
    [jump, listRef],
  );

  return { inset, jumpAboveSheet };
}
