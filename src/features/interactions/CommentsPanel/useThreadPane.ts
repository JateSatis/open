// Мутация `.value` у shared value — штатный API Reanimated, а не нарушение
// чистоты, которое видит в этом React Compiler.
/* eslint-disable react-hooks/immutability */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type { OpenThreadState } from '@/features/interactions/comments/commentsPanelStore';
import { Spacing } from '@/theme';

/** Жест «назад» от левого края окна треда — для тестов. */
export const THREAD_EDGE_PAN_TEST_ID = 'comments-thread-edge-pan';

/** Ширина полосы у левого края, с которой окно треда тянут назад. */
const EDGE_WIDTH = Spacing.five;
/** Сдвиг вправо, после которого жест края — назад, а не тап. */
const EDGE_ACTIVATION_PX = Spacing.three;
/** Сдвиг вверх-вниз, после которого жест края уступает списку. */
const EDGE_FAIL_PX = Spacing.three;
/** Отпустили правее этой доли ширины — окно уходит. */
const EDGE_RELEASE_SHARE = 0.3;
/** Бросок вправо быстрее этого — окно уходит, как бы мало ни сдвинули. */
const EDGE_RELEASE_VELOCITY = 800;
/** Основной список под окном отъезжает влево на эту долю ширины — как стек экранов. */
const UNDERLAY_SHIFT = 0.25;

const SLIDE = { duration: 260, easing: Easing.out(Easing.cubic) };

type Options = {
  openThread: OpenThreadState | null;
  width: number;
  /** Окно ушло жестом края — тред закрыть. */
  onExit: () => void;
};

/**
 * Окно треда поверх основного списка: въезжает справа, уходит вправо —
 * стрелкой, «назад» или свайпом от левого края. Уезжающее окно рисует свой
 * тред до конца анимации (`shownRoot`), хотя в сторе его уже нет.
 */
export function useThreadPane({ openThread, width, onExit }: Options) {
  const rootId = openThread?.rootId ?? null;
  const instant = openThread?.instant ?? false;
  const [leaving, setLeaving] = useState<string | null>(null);
  const [lastRoot, setLastRoot] = useState(rootId);
  /** Сдвиг окна вправо: 0 — на месте, `width` — за краем. */
  const offset = useSharedValue(rootId ? 0 : width);

  // Тред закрылся — его окно ещё уезжает и рисует его же.
  if (lastRoot !== rootId) {
    setLastRoot(rootId);
    setLeaving(rootId ? null : lastRoot);
  }

  const finishLeaving = useCallback(() => setLeaving(null), []);

  useEffect(() => {
    if (rootId) {
      offset.value = instant ? 0 : withTiming(0, SLIDE);
      return;
    }

    offset.value = withTiming(width, SLIDE, (finished) => {
      if (finished) runOnJS(finishLeaving)();
    });
  }, [finishLeaving, instant, offset, rootId, width]);

  const edgePan = useMemo(
    () =>
      Gesture.Pan()
        .withTestId(THREAD_EDGE_PAN_TEST_ID)
        .enabled(rootId !== null)
        .hitSlop({ left: 0, width: EDGE_WIDTH })
        .activeOffsetX(EDGE_ACTIVATION_PX)
        .failOffsetY([-EDGE_FAIL_PX, EDGE_FAIL_PX])
        .onUpdate((event) => {
          offset.value = Math.min(width, Math.max(0, event.translationX));
        })
        .onEnd((event) => {
          if (
            offset.value > width * EDGE_RELEASE_SHARE ||
            event.velocityX > EDGE_RELEASE_VELOCITY
          ) {
            runOnJS(onExit)();
            return;
          }

          offset.value = withTiming(0, SLIDE);
        }),
    [offset, onExit, rootId, width],
  );

  const paneStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  const underlayStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (offset.value - width) * UNDERLAY_SHIFT }],
  }));

  return { shownRoot: rootId ?? leaving, edgePan, paneStyle, underlayStyle };
}
