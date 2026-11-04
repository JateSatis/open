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
  /** `false` — только прокрутка: строку подсветит тот, кто прыгал. */
  flash?: boolean;
  /**
   * Где встать строке: доля высоты от низа переписки (список перевёрнут). По
   * умолчанию — по центру, плавно; с долей — сразу, без прокрутки на глазах:
   * так переключение вида держит место чтения.
   */
  viewPosition?: number;
};

type Target = { rowKey: string; viewPosition: number | null };

export type JumpToMessage = {
  /**
   * Прокручивает к строке и подсвечивает её. Если она ещё не загружена,
   * загружает окно вокруг `seq` одним сетевым кругом. Отвечает, нашлось ли.
   * `flash: false` — только прокрутка: строку подсветит тот, кто прыгал.
   */
  jump: (rowKey: string, seq: number, options?: JumpOptions) => Promise<boolean>;
  highlight: JumpHighlight | null;
  positioned: boolean;
  onVisible: (keys: string[]) => void;
  /** Для `onScrollToIndexFailed` списка: строки разной высоты, и до далёкой списку не долистать с первого раза. */
  onScrollToIndexFailed: (info: ScrollFailure) => void;
};

/** Сколько ждать, пока список дорисует строки вокруг примерной позиции. */
const RETRY_SCROLL_MS = 120;
const MAX_ALIGN_ATTEMPTS = 12;

/** Строка по центру переписки — или на заданной высоте, сразу. */
function placeOf(index: number, viewPosition: number | null) {
  return viewPosition === null
    ? { index, viewPosition: 0.5, animated: true }
    : { index, viewPosition, animated: false };
}

/**
 * Прыжок к сообщению в перевёрнутой переписке — к закреплённому, а потом и
 * к цитате в ответе. Далёкую цель получает отдельным окном.
 */
export function useJumpToMessage(
  listRef: RefObject<FlatList<ChatListRow> | null>,
  rows: ChatListRow[],
  loadWindow: (seq: number) => Promise<boolean>,
  initiallyPositioned = true,
): JumpToMessage {
  const [highlight, setHighlight] = useState<JumpHighlight | null>(null);
  const [positioned, setPositioned] = useState(initiallyPositioned);
  // Каждый прыжок — со вспышкой и без — ждёт своей строки в списке.
  const [jumps, setJumps] = useState(0);
  // Цель — в ref, а не в состоянии: прокрутка — побочное действие, и
  // перерисовку ради неё запускает уже смена подсветки.
  const targetRef = useRef<Target | null>(null);
  const visibleKeyRef = useRef<string | null>(null);
  // Куда встать при повторе после неудачной прокрутки к далёкой строке.
  const placeRef = useRef<number | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alignTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alignAttemptsRef = useRef(0);

  // Цель прокручивается, когда она уже в списке: после догрузки строки
  // появляются только на следующей отрисовке.
  useEffect(() => {
    const target = targetRef.current;

    if (!target) return;

    const index = rows.findIndex((row) => row.key === target.rowKey);

    if (index === -1) return;

    targetRef.current = null;
    visibleKeyRef.current = target.rowKey;
    alignAttemptsRef.current = 0;
    placeRef.current = target.viewPosition;
    listRef.current?.scrollToIndex(placeOf(index, target.viewPosition));
    if (alignTimerRef.current) clearTimeout(alignTimerRef.current);
    const align = () => {
      if (visibleKeyRef.current !== target.rowKey) return;
      if (alignAttemptsRef.current >= MAX_ALIGN_ATTEMPTS) {
        listRef.current?.scrollToIndex(placeOf(index, target.viewPosition ?? 0.5));
        alignTimerRef.current = setTimeout(() => {
          if (visibleKeyRef.current !== target.rowKey) return;
          visibleKeyRef.current = null;
          setPositioned(true);
        }, RETRY_SCROLL_MS);
        return;
      }
      alignAttemptsRef.current += 1;
      listRef.current?.scrollToIndex(placeOf(index, target.viewPosition));
      alignTimerRef.current = setTimeout(align, RETRY_SCROLL_MS);
    };
    alignTimerRef.current = setTimeout(align, RETRY_SCROLL_MS);
  }, [jumps, listRef, rows]);

  useEffect(
    () => () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      if (alignTimerRef.current) clearTimeout(alignTimerRef.current);
    },
    [],
  );

  const jump = useCallback(
    async (rowKey: string, seq: number, { flash = true, viewPosition }: JumpOptions = {}) => {
      const loaded = rows.some((row) => row.key === rowKey);
      const found = loaded || (await loadWindow(seq));

      if (!found) {
        setPositioned(true);
        return false;
      }

      targetRef.current = { rowKey, viewPosition: viewPosition ?? null };
      setJumps((count) => count + 1);

      if (flash) setHighlight({ messageId: rowKey, key: Date.now() });

      return true;
    },
    [loadWindow, rows],
  );

  const onScrollToIndexFailed = useCallback(
    ({ index, averageItemLength }: ScrollFailure) => {
      // Сначала примерно — туда, где строка должна быть по средней высоте,
      // потом точно, когда строки вокруг отрисованы и измерены.
      listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });

      if (retryRef.current) clearTimeout(retryRef.current);

      retryRef.current = setTimeout(() => {
        listRef.current?.scrollToIndex(placeOf(index, placeRef.current));
      }, RETRY_SCROLL_MS);
    },
    [listRef],
  );

  const onVisible = useCallback((keys: string[]) => {
    const targetKey = visibleKeyRef.current;
    if (!targetKey || !keys.includes(targetKey)) return;

    const index = rows.findIndex((row) => row.key === targetKey);
    if (index === -1) return;
    listRef.current?.scrollToIndex(placeOf(index, placeRef.current ?? 0.5));
    visibleKeyRef.current = null;
    if (alignTimerRef.current) clearTimeout(alignTimerRef.current);
    alignTimerRef.current = setTimeout(() => setPositioned(true), RETRY_SCROLL_MS);
  }, [listRef, rows]);

  return { jump, highlight, positioned, onVisible, onScrollToIndexFailed };
}
