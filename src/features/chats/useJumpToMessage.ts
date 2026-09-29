import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { FlatList } from 'react-native';

import type { ChatMessage } from '@/features/chats/messages/types';

/** Сообщение, которое сейчас подсвечено; `key` меняется при каждом прыжке. */
export type JumpHighlight = { messageId: string; key: number };

type ScrollFailure = { index: number; averageItemLength: number };

export type JumpToMessage = {
  /**
   * Прокручивает к сообщению и подсвечивает его. Если оно ещё не загружено,
   * сначала догружает историю до него — по страницам. Отвечает, нашлось ли.
   */
  jump: (messageId: string, createdAt: string) => Promise<boolean>;
  highlight: JumpHighlight | null;
  /** Для `onScrollToIndexFailed` списка: строки разной высоты, и до далёкой списку не долистать с первого раза. */
  onScrollToIndexFailed: (info: ScrollFailure) => void;
};

/** Сколько ждать, пока список дорисует строки вокруг примерной позиции. */
const RETRY_SCROLL_MS = 120;

/**
 * Прыжок к сообщению в перевёрнутой переписке — к закреплённому, а потом и
 * к цитате в ответе. Переписка остаётся постраничной: догружается ровно
 * столько страниц назад, сколько нужно до цели.
 */
export function useJumpToMessage(
  listRef: RefObject<FlatList<ChatMessage> | null>,
  messages: ChatMessage[],
  loadUntil: (createdAt: string) => Promise<boolean>,
): JumpToMessage {
  const [highlight, setHighlight] = useState<JumpHighlight | null>(null);
  // Цель — в ref, а не в состоянии: прокрутка — побочное действие, и
  // перерисовку ради неё запускает уже смена подсветки.
  const targetRef = useRef<string | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Цель прокручивается, когда она уже в списке: после догрузки строки
  // появляются только на следующей отрисовке.
  useEffect(() => {
    const target = targetRef.current;

    if (!target) return;

    const index = messages.findIndex((message) => message.id === target);

    if (index === -1) return;

    targetRef.current = null;
    listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
  }, [highlight, listRef, messages]);

  useEffect(
    () => () => {
      if (retryRef.current) clearTimeout(retryRef.current);
    },
    [],
  );

  const jump = useCallback(
    async (messageId: string, createdAt: string) => {
      const found = await loadUntil(createdAt);

      if (!found) return false;

      targetRef.current = messageId;
      setHighlight({ messageId, key: Date.now() });

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
        listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
      }, RETRY_SCROLL_MS);
    },
    [listRef],
  );

  return { jump, highlight, onScrollToIndexFailed };
}
