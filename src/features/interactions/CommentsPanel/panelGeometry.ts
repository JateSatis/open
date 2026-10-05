/** В верхнем положении низ исходного сообщения стоит на этой доле экрана: комментариям — 80%. */
const FULL_SHARE = 0.2;
/** В среднем — на середине экрана. */
const HALF_SHARE = 0.5;
/** Середина ближе этого к верху — это не середина: шит открывается сразу наверх. */
const MIN_HALF_GAP = 48;
/** Утащили ниже среднего положения на эту долю видимой высоты шита — отпускание закрывает. */
const DISMISS_RATIO = 0.2;

export type PanelGeometry = {
  /** Верх шита в верхнем положении — он же верх окна списка. */
  top: number;
  /**
   * Ход шита от среднего положения до верхнего. Он же высота прозрачного
   * отступа в начале содержимого списка: пока скролл внутри него, едет шит.
   */
  travel: number;
  /** Окно списка — от верха шита до низа окна. */
  listHeight: number;
  /** Высота шита в среднем положении — от неё гаснет затемнение. */
  halfHeight: number;
  /** Ниже среднего положения на столько — отпускание закрывает. */
  dismissDistance: number;
};

/**
 * Положения шита комментариев. Шапка шита (ручка, заголовок и исходное
 * сообщение) высотой `headerHeight` стоит над комментариями, и положения
 * меряются по её низу:
 *
 * - верхнее — низ исходного сообщения на 20% от верха экрана;
 * - среднее — на середине экрана.
 *
 * Высокое сообщение подняло бы верх шита под статус-бар — выше он не встаёт.
 * Середина, слишком близкая к верху, исчезает: шит открывается сразу наверх.
 *
 * Значения — в целых физических пикселях: они задают начало содержимого
 * списка, и дробные сдвигали бы строки на долю пикселя.
 */
export function panelGeometry(
  windowHeight: number,
  insetTop: number,
  headerHeight: number,
  scale: number,
): PanelGeometry {
  const snap = (dp: number) => Math.round(dp * scale) / scale;

  const top = snap(Math.max(insetTop, windowHeight * FULL_SHARE - headerHeight));
  const half = snap(windowHeight * HALF_SHARE - headerHeight);
  const gap = half - top;
  const travel = gap < MIN_HALF_GAP ? 0 : gap;
  const halfHeight = windowHeight - top - travel;

  return {
    top,
    travel,
    listHeight: windowHeight - top,
    halfHeight,
    dismissDistance: halfHeight * DISMISS_RATIO,
  };
}
