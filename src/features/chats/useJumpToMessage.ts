import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { FlatList } from 'react-native';

import type { ChatListRow } from '@/features/chats/islands/rows';

/**
 * Строка, которая сейчас подсвечена: сообщение или облачко островка. `key`
 * меняется при каждом прыжке.
 */
export type JumpHighlight = { messageId: string; key: number };

type ScrollFailure = { index: number; averageItemLength: number };

export type JumpOptions = {
  /**
   * Сколько низа списка закрыто поверх (шит комментариев): строка встаёт по
   * центру того, что над ним, а не по центру всего списка.
   */
  inset?: number;
};

export type JumpToMessage = {
  /**
   * Прокручивает к строке и подсвечивает её. Если она ещё не загружена,
   * сначала догружает историю до `createdAt` — времени сообщения или
   * островка, где оно стоит, — по страницам. Отвечает, нашлось ли.
   */
  jump: (rowKey: string, createdAt: string, options?: JumpOptions) => Promise<boolean>;
  highlight: JumpHighlight | null;
  /** Для `onScrollToIndexFailed` списка: строки разной высоты, и до далёкой списку не долистать с первого раза. */
  onScrollToIndexFailed: (info: ScrollFailure) => void;
};

/** Сколько ждать, пока список дорисует строки вокруг примерной позиции. */
const RETRY_SCROLL_MS = 120;

/**
 * Строка по центру видимой части. Список перевёрнут: смещение отсчитывается
 * от низа экрана, и положительный `viewOffset` поднимает строку — на половину
 * закрытого низа, то есть в центр того, что над ним.
 */
function centerOf(index: number, inset: number) {
  return { index, viewPosition: 0.5, viewOffset: inset / 2, animated: true };
}

/**
 * Прыжок к сообщению в перевёрнутой переписке — к закреплённому, а потом и
 * к цитате в ответе. Переписка остаётся постраничной: догружается ровно
 * столько страниц назад, сколько нужно до цели.
 */
export function useJumpToMessage(
  listRef: RefObject<FlatList<ChatListRow> | null>,
  rows: ChatListRow[],
  loadUntil: (createdAt: string) => Promise<boolean>,
): JumpToMessage {
  const [highlight, setHighlight] = useState<JumpHighlight | null>(null);
  // Цель — в ref, а не в состоянии: прокрутка — побочное действие, и
  // перерисовку ради неё запускает уже смена подсветки.
  const targetRef = useRef<{ key: string; inset: number } | null>(null);
  // Закрытый низ последнего прыжка — для повторной прокрутки после промаха.
  const insetRef = useRef(0);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Цель прокручивается, когда она уже в списке: после догрузки строки
  // появляются только на следующей отрисовке.
  useEffect(() => {
    const target = targetRef.current;

    if (!target) return;

    const index = rows.findIndex((row) => row.key === target.key);

    if (index === -1) return;

    targetRef.current = null;
    listRef.current?.scrollToIndex(centerOf(index, target.inset));
  }, [highlight, listRef, rows]);

  useEffect(
    () => () => {
      if (retryRef.current) clearTimeout(retryRef.current);
    },
    [],
  );

  const jump = useCallback(
    async (rowKey: string, createdAt: string, options?: JumpOptions) => {
      const found = await loadUntil(createdAt);

      if (!found) return false;

      const inset = options?.inset ?? 0;

      insetRef.current = inset;
      targetRef.current = { key: rowKey, inset };
      setHighlight({ messageId: rowKey, key: Date.now() });

      return true;
    },
    [loadUntil],
  );

  const onScrollToIndexFailed = useCallback(
    ({ index, averageItemLength }: ScrollFailure) => {
      // Сначала примерно — туда, где строка должна быть по средней высоте,
      // потом точно, когда строки вокруг отрисованы и измерены.
      listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });

      if (retryRef.current) clearTimeout(retryRef.current);

      retryRef.current = setTimeout(() => {
        listRef.current?.scrollToIndex(centerOf(index, insetRef.current));
      }, RETRY_SCROLL_MS);
    },
    [listRef],
  );

  return { jump, highlight, onScrollToIndexFailed };
}
