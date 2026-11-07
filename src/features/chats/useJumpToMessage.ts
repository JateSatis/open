// Мутация `.value` у shared value — штатный API Reanimated, а не нарушение
// чистоты, которое видит в этом React Compiler.
/* eslint-disable react-hooks/immutability */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { FlatList } from 'react-native';
import {
  Easing,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import type { ChatListRow } from '@/features/chats/islands/rows';
import { navigationPerfMark, navigationPerfStart } from '@/features/media/perf';

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
   * Где встать строке: доля высоты от низа переписки (список перевёрнут).
   * Заданная доля тоже приезжает одним плавным движением.
   */
  viewPosition?: number;
};

type Target = { rowKey: string; viewPosition: number | null };

/** Иллюзия быстрой прокрутки: сколько высот экрана проезжает список за анимацию. */
export const GLIDE_SCREENS = 1.5;
export const GLIDE_MS = 170;
export const GLIDE_EASING = Easing.out(Easing.cubic);

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
  onMomentumScrollEnd: () => void;
  onListReady: () => void;
  /** Для `onScrollToIndexFailed` списка: строки разной высоты, и до далёкой списку не долистать с первого раза. */
  onScrollToIndexFailed: (info: ScrollFailure) => void;
};

/** Сколько ждать, пока список дорисует строки вокруг примерной позиции. */
const RETRY_SCROLL_MS = 16;

/** Строка по центру переписки — или на заданной высоте. */
function placeOf(index: number, viewPosition: number | null, animated: boolean) {
  return { index, viewPosition: viewPosition ?? 0.5, animated };
}

/**
 * Прыжок к сообщению в перевёрнутой переписке — к закреплённому, а потом и
 * к цитате в ответе. Далёкую цель получает отдельным окном.
 */
export function useJumpToMessage(
  listRef: RefObject<FlatList<ChatListRow> | null>,
  rows: readonly { key: string; message?: { seq: number }; island?: { seq: number } }[],
  loadWindow: (seq: number) => Promise<boolean>,
  initiallyPositioned = true,
  glide: SharedValue<number>,
  viewport: () => number,
): JumpToMessage {
  const [highlight, setHighlight] = useState<JumpHighlight | null>(null);
  const [positioned, setPositioned] = useState(initiallyPositioned);
  // Повторное чтение строк нужно только для удалённой цели или смены вида.
  const [jumps, setJumps] = useState(0);
  // Цель — в ref, а не в состоянии: прокрутка — побочное действие, и
  // перерисовку ради неё запускает уже смена подсветки.
  const targetRef = useRef<Target | null>(null);
  const visibleKeyRef = useRef<string | null>(null);
  // Куда встать при повторе после неудачной прокрутки к далёкой строке.
  const placeRef = useRef<number | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alignAfterVisibleRef = useRef(false);
  const failedRetryRef = useRef(false);
  const waitingForListRef = useRef(false);
  const placeRequestRef = useRef<ReturnType<typeof placeOf> | null>(null);
  const attemptNumberRef = useRef(0);
  const attemptIdRef = useRef<string | null>(null);
  const glidePendingRef = useRef(false);
  const visibleIndexRef = useRef(0);
  const glideStartedRef = useRef(0);

  // Цель прокручивается, когда она уже в списке: после догрузки строки
  // появляются только на следующей отрисовке.
  useEffect(() => {
    const target = targetRef.current;

    if (!target) return;

    const index = rows.findIndex((row) => row.key === target.rowKey);

    if (index === -1) return;

    navigationPerfMark(attemptIdRef.current ?? '', 'scroll-request', {
      index,
      viewPosition: target.viewPosition,
    });

    targetRef.current = null;
    visibleKeyRef.current = target.rowKey;
    placeRef.current = target.viewPosition;
    failedRetryRef.current = false;
    placeRequestRef.current = placeOf(index, target.viewPosition, false);
    listRef.current?.scrollToIndex(placeRequestRef.current);
  }, [jumps, listRef, rows]);

  useEffect(
    () => () => {
      if (retryRef.current) clearTimeout(retryRef.current);
    },
    [],
  );

  const jump = useCallback(
    async (rowKey: string, seq: number, { flash = true, viewPosition }: JumpOptions = {}) => {
      const attemptId = `message-${Date.now()}-${++attemptNumberRef.current}`;
      if (retryRef.current) {
        clearTimeout(retryRef.current);
        retryRef.current = null;
      }
      waitingForListRef.current = false;
      attemptIdRef.current = attemptId;
      navigationPerfStart(attemptId, 'message', { rowKey, seq, flash, viewPosition });
      const indexBeforeLoad = rows.findIndex((row) => row.key === rowKey);
      const loaded = indexBeforeLoad !== -1;
      const distant = !loaded || Math.abs(indexBeforeLoad - visibleIndexRef.current) * 96 > Math.max(1, viewport()) * 1.5;
      if (!distant) glidePendingRef.current = false;
      if (distant && initiallyPositioned) {
        const visibleRow = rows[visibleIndexRef.current];
        const visibleSeq = visibleRow?.message?.seq ?? visibleRow?.island?.seq;
        const direction = loaded
          ? (indexBeforeLoad < visibleIndexRef.current ? -1 : 1)
          : (visibleSeq !== undefined && seq > visibleSeq ? -1 : 1);
        glidePendingRef.current = true;
        glideStartedRef.current = Date.now();
        navigationPerfMark(attemptId, 'glide-start', { direction });
        glide.value = direction * GLIDE_SCREENS * Math.max(1, viewport());
        glide.value = withTiming(0, { duration: GLIDE_MS, easing: GLIDE_EASING });
      }
      navigationPerfMark(attemptId, loaded ? 'target-in-current-rows' : 'window-request');
      const found = loaded || (await loadWindow(seq));
      if (attemptIdRef.current !== attemptId) return false;
      navigationPerfMark(attemptId, 'target-data-ready', { found });

      if (!found) {
        glidePendingRef.current = false;
        glide.value = 0;
        targetRef.current = null;
        visibleKeyRef.current = null;
        alignAfterVisibleRef.current = false;
        setPositioned(true);
        return false;
      }

      const target = { rowKey, viewPosition: viewPosition ?? null };
      const index = rows.findIndex((row) => row.key === rowKey);
      const list = listRef.current;
      visibleKeyRef.current = rowKey;
      placeRef.current = target.viewPosition;
      failedRetryRef.current = false;

      if (loaded && list && index !== -1 && !distant) {
        targetRef.current = null;
        alignAfterVisibleRef.current = false;
        // Маршрутный переход (экран въезжает уже на цели) — цель ставится
        // сразу, скрытым списком; видимая плавная прокрутка — только для
        // перехода внутри уже открытого чата.
        const animated = initiallyPositioned;
        navigationPerfMark(attemptId, 'scroll-request', {
          index,
          viewPosition: target.viewPosition ?? 0.5,
          animated,
        });
        placeRequestRef.current = placeOf(index, target.viewPosition, animated);
        list.scrollToIndex(placeRequestRef.current);
      } else if (loaded && list && index !== -1) {
        targetRef.current = null;
        alignAfterVisibleRef.current = false;
        placeRequestRef.current = placeOf(index, target.viewPosition, false);
        list.scrollToIndex(placeRequestRef.current);
      } else {
        targetRef.current = target;
        alignAfterVisibleRef.current = true;
        // Далёкая цель едет иллюзией быстрой прокрутки, а не появляется
        // мгновенно. Внутри чата далёкая цель всегда старше места чтения —
        // направление «вверх».
        setPositioned(false);
        setJumps((count) => count + 1);
      }

      if (flash) setHighlight({ messageId: rowKey, key: Date.now() });

      return true;
    },
    [glide, initiallyPositioned, listRef, loadWindow, rows, viewport],
  );

  const onScrollToIndexFailed = useCallback(
    ({ index, averageItemLength }: ScrollFailure) => {
      navigationPerfMark(attemptIdRef.current ?? '', 'scroll-index-failed', {
        index,
        averageItemLength,
      });

      if (averageItemLength > 0) {
        listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });
      } else {
        // На новом экране FlatList ещё не измерил ни одной строки. Повтор по
        // таймеру снова падает в тот же ноль; ждём первого размера содержимого.
        waitingForListRef.current = true;
        return;
      }

      if (retryRef.current || failedRetryRef.current) return;

      failedRetryRef.current = true;
      retryRef.current = setTimeout(() => {
        retryRef.current = null;
        const request = placeRequestRef.current ?? placeOf(index, placeRef.current, false);
        placeRequestRef.current = { ...request, animated: false };
        listRef.current?.scrollToIndex(placeRequestRef.current);
      }, RETRY_SCROLL_MS);
    },
    [listRef],
  );

  const onVisible = useCallback((keys: string[]) => {
    const first = rows.findIndex((row) => keys.includes(row.key));
    if (first !== -1) visibleIndexRef.current = first;
    const targetKey = visibleKeyRef.current;
    if (!targetKey || !keys.includes(targetKey)) return;

    const index = rows.findIndex((row) => row.key === targetKey);
    if (index === -1) return;
    navigationPerfMark(attemptIdRef.current ?? '', 'target-first-visible', { index });
    visibleKeyRef.current = null;
    waitingForListRef.current = false;

    if (glidePendingRef.current) {
      glidePendingRef.current = false;
      setPositioned(true);
      if (Date.now() - glideStartedRef.current >= GLIDE_MS) glide.value = 0;
      navigationPerfMark(attemptIdRef.current ?? '', 'positioned');
      return;
    }

    setPositioned(true);
    if (!alignAfterVisibleRef.current) return;

    alignAfterVisibleRef.current = false;
    navigationPerfMark(attemptIdRef.current ?? '', 'positioned');
    requestAnimationFrame(() => setPositioned(true));
  }, [glide, rows]);

  const onMomentumScrollEnd = useCallback(() => {
    navigationPerfMark(attemptIdRef.current ?? '', 'momentum-end');
  }, []);

  const onListReady = useCallback(() => {
    if (!waitingForListRef.current || !placeRequestRef.current) return;

    navigationPerfMark(attemptIdRef.current ?? '', 'list-ready');
    // Видимая цель часто приходит в том же кадре, что и первая раскладка.
    // Повторный scrollToIndex до этого кадра снова падает с нулевой длиной.
    requestAnimationFrame(() => {
      if (!waitingForListRef.current || !visibleKeyRef.current) return;
      waitingForListRef.current = false;
      listRef.current?.scrollToIndex(placeRequestRef.current!);
    });
  }, [listRef]);

  return {
    jump,
    highlight,
    positioned,
    onVisible,
    onMomentumScrollEnd,
    onListReady,
    onScrollToIndexFailed,
  };
}
