/** Над полным положением всегда видна эта доля экрана: шит занимает не больше 80%. */
const FULL_TOP_SHARE = 0.2;
/** Половина ближе этого к полному — это не половина: остаётся только полное положение. */
const MIN_HALF_GAP = 48;
/** Утащили ниже нижнего положения на эту долю видимой высоты шита — отпускание закрывает. */
const DISMISS_RATIO = 0.2;
/** Скорость, с которой шит смахивают, а не тащат (dp/с). */
export const PANEL_FLING_VELOCITY = 800;

export type PanelSnaps = {
  /** Верх шита в полном положении. */
  full: number;
  /** Верх шита в половине; `null` — сообщение высокое, и половины нет. */
  half: number | null;
  /** Верх закрытого шита — за нижним краем окна. */
  closed: number;
};

export type PanelSnap = 'full' | 'half' | 'closed';

/**
 * Положения шита комментариев — по верхнему краю шита в окне.
 *
 * Половина — когда нижняя граница исходного сообщения приходится ровно на
 * середину экрана. Высокое сообщение подняло бы шит выше полного — тогда
 * половины нет, шит открывается полным.
 *
 * @param windowHeight высота окна
 * @param topInset     низ шапки экрана: выше шит не встаёт никогда
 * @param regionBottom низ исходного сообщения, отсчитанный от верха шита
 */
export function panelSnaps(windowHeight: number, topInset: number, regionBottom: number): PanelSnaps {
  'worklet';

  const full = Math.max(topInset, windowHeight * FULL_TOP_SHARE);
  const half = windowHeight / 2 - regionBottom;

  return {
    full,
    half: half - full < MIN_HALF_GAP ? null : half,
    closed: windowHeight,
  };
}

/**
 * Куда шит едет после того, как палец отпустили. Вынесено из worklet'а, чтобы
 * у порогов был тест, как у `shouldDismissSheet` шита медиа.
 *
 * - бросок вниз закрывает шит из любого положения, а не цепляется за половину;
 * - бросок вверх разворачивает в полное;
 * - медленное перетаскивание — к ближайшему положению, а закрытие — только
 *   когда шит утащили ниже нижнего положения на пятую часть его высоты.
 *
 * @param top       верх шита в момент отпускания
 * @param velocityY скорость пальца, вниз — положительная
 */
export function resolvePanelSnap(top: number, velocityY: number, snaps: PanelSnaps): PanelSnap {
  'worklet';

  if (velocityY > PANEL_FLING_VELOCITY) return 'closed';
  if (velocityY < -PANEL_FLING_VELOCITY) return 'full';

  const lowest = snaps.half ?? snaps.full;
  const dismissDistance = (snaps.closed - lowest) * DISMISS_RATIO;

  if (top > lowest + dismissDistance) return 'closed';
  if (snaps.half === null) return 'full';

  return top < (snaps.full + snaps.half) / 2 ? 'full' : 'half';
}

/** Верх шита в положении. */
export function snapTop(snap: PanelSnap, snaps: PanelSnaps): number {
  'worklet';

  if (snap === 'closed') return snaps.closed;
  if (snap === 'half' && snaps.half !== null) return snaps.half;

  return snaps.full;
}
