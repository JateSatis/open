/** Верх шита — на этой доле высоты экрана: комментариям остаётся 75%. */
const TOP_SHARE = 0.25;
/** Утащили вниз на эту долю высоты шита — отпускание закрывает. */
const DISMISS_RATIO = 0.2;

export type PanelGeometry = {
  /** Верх шита — он же верх окна списка. */
  top: number;
  /** Высота шита — от его верха до низа окна. */
  height: number;
  /** Утащили вниз на столько — отпускание закрывает. */
  dismissDistance: number;
};

/**
 * Положение шита комментариев одно: верх на четверти высоты экрана, но не
 * выше статус-бара. Выше шит не поднимается, ниже — только закрываясь.
 *
 * Значения — в целых физических пикселях: дробный верх сдвигал бы строки
 * списка на долю пикселя.
 */
export function panelGeometry(
  windowHeight: number,
  insetTop: number,
  scale: number,
): PanelGeometry {
  const snap = (dp: number) => Math.round(dp * scale) / scale;
  const top = snap(Math.max(insetTop, windowHeight * TOP_SHARE));
  const height = windowHeight - top;

  return { top, height, dismissDistance: height * DISMISS_RATIO };
}
