export type FingerState = {
  /** Палец сейчас ведёт шит, а не список. */
  dismissing: boolean;
  /** Сдвиг пальца, с которого шит начал уходить вниз. */
  anchor: number;
  /** Сдвиг пальца на прошлом кадре — по нему видно направление. */
  lastTranslation: number;
};

export type FingerStep = FingerState & {
  /** Куда поставить шит; `null` — шит не трогать, движение принадлежит списку. */
  dismissY: number | null;
};

/**
 * Один кадр движения пальца: кто его получает — список или шит.
 *
 * Шит перехватывает движение, как только список упёрся в верх, а палец идёт
 * вниз, — посреди жеста, с того места, где список остановился. Вернулся шит в
 * рабочее положение — движение снова отдаётся списку.
 *
 * @param scrollOffset позиция скролла списка в этом кадре
 */
export function followFinger(
  state: FingerState,
  translationY: number,
  scrollOffset: number,
): FingerStep {
  'worklet';

  const movingDown = translationY > state.lastTranslation;
  let { dismissing, anchor } = state;

  if (!dismissing) {
    if (!movingDown || scrollOffset > 0) {
      return { dismissing, anchor, lastTranslation: translationY, dismissY: null };
    }

    dismissing = true;
    anchor = translationY;
  }

  const next = Math.max(translationY - anchor, 0);

  // Отдать движение списку можно, только когда палец идёт вверх: в кадре
  // перехвата шит тоже стоит в нуле, но палец там идёт вниз.
  if (next === 0 && !movingDown) {
    return { dismissing: false, anchor, lastTranslation: translationY, dismissY: 0 };
  }

  return { dismissing, anchor, lastTranslation: translationY, dismissY: next };
}

/**
 * Начало жеста. Если шит подхватили, пока он ещё едет, палец продолжает с
 * того места, где его застал.
 */
export function startFinger(translationY: number, dismissY: number): FingerState {
  'worklet';

  return {
    dismissing: dismissY > 0,
    anchor: translationY - dismissY,
    lastTranslation: translationY,
  };
}
