import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { FlatList } from 'react-native';

import type { ChatListRow } from '@/features/chats/islands/rows';

/**
 * Строка, которая сейчас подсвечена: сообщение или облачко островка. `key`
 * меняется при каждом прыжке.
 */
export type JumpHighlight = { messageId: string; key: number };

type ScrollFailure = { index: number; averageItemLength: number };

export type JumpToMessage = {
  /**
   * Прокручивает к строке и подсвечивает её. Если она ещё не загружена,
   * сначала догружает историю до `seq` — номера сообщения или
   * островка, где оно стоит, — по страницам. Отвечает, нашлось ли.
   * `flash: false` — только прокрутка: строку подсветит тот, кто прыгал.
   */
  jump: (rowKey: string, seq: number, options?: { flash?: boolean }) => Promise<boolean>;
  highlight: JumpHighlight | null;
  /** Для `onScrollToIndexFailed` списка: строки разной высоты, и до далёкой списку не долистать с первого раза. */
  onScrollToIndexFailed: (info: ScrollFailure) => void;
};

/** Сколько ждать, пока список дорисует строки вокруг примерной позиции. */
const RETRY_SCROLL_MS = 120;

/** Строка по центру переписки. */
function centerOf(index: number) {
  return { index, viewPosition: 0.5, animated: true };
}

/**
 * Прыжок к сообщению в перевёрнутой переписке — к закреплённому, а потом и
 * к цитате в ответе. Переписка остаётся постраничной: догружается ровно
 * столько страниц назад, сколько нужно до цели.
 */
export function useJumpToMessage(
  listRef: RefObject<FlatList<ChatListRow> | null>,
  rows: ChatListRow[],
  loadUntil: (seq: number) => Promise<boolean>,
): JumpToMessage {
  const [highlight, setHighlight] = useState<JumpHighlight | null>(null);
  // Каждый прыжок — со вспышкой и без — ждёт своей строки в списке.
  const [jumps, setJumps] = useState(0);
  // Цель — в ref, а не в состоянии: прокрутка — побочное действие, и
  // перерисовку ради неё запускает уже смена подсветки.
  const targetRef = useRef<string | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Цель прокручивается, когда она уже в списке: после догрузки строки
  // появляются только на следующей отрисовке.
  useEffect(() => {
    const target = targetRef.current;

    if (!target) return;

    const index = rows.findIndex((row) => row.key === target);

    if (index === -1) return;

    targetRef.current = null;
    listRef.current?.scrollToIndex(centerOf(index));
  }, [jumps, listRef, rows]);

  useEffect(
    () => () => {
      if (retryRef.current) clearTimeout(retryRef.current);
    },
    [],
  );

  const jump = useCallback(
    async (rowKey: string, seq: number, { flash = true }: { flash?: boolean } = {}) => {
      const found = await loadUntil(seq);

      if (!found) return false;

      targetRef.current = rowKey;
      setJumps((count) => count + 1);

      if (flash) setHighlight({ messageId: rowKey, key: Date.now() });

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
        listRef.current?.scrollToIndex(centerOf(index));
      }, RETRY_SCROLL_MS);
    },
    [listRef],
  );

  return { jump, highlight, onScrollToIndexFailed };
}
