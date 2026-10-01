/** Сильнее не увеличить. */
export const MAX_SCALE = 4;
/** Во столько раз увеличивает двойной тап. */
export const DOUBLE_TAP_SCALE = 2.5;
/** Доля ширины экрана, протащив которую, листаешь на соседнее медиа. */
const PAGE_DISTANCE_SHARE = 0.25;
/** Доля высоты экрана, протащив которую вверх или вниз, закрываешь просмотр. */
const DISMISS_DISTANCE_SHARE = 0.15;
/** Скорость броска (dp/с): листает и закрывает, даже если палец прошёл мало. */
export const VIEWER_FLING_VELOCITY = 800;
/** Насколько тугая резина за краем: чем меньше, тем туже. */
const RUBBER = 0.35;

/**
 * Резина за краем, как в Telegram: палец уходит дальше, а картинка — всё
 * медленнее.
 */
export function rubberBand(overflow: number, dimension: number): number {
  'worklet';

  if (overflow === 0 || dimension <= 0) return 0;

  const sign = overflow < 0 ? -1 : 1;
  const distance = Math.abs(overflow);

  return sign * (1 - 1 / ((distance * RUBBER) / dimension + 1)) * dimension;
}

/**
 * Насколько можно сдвинуть увеличенное медиа от центра, чтобы край не
 * отходил от края экрана. Медиа вписано в экран целиком (`contain`), поэтому
 * его размер на экране — вписанный, умноженный на увеличение.
 */
export function panBound(contentSize: number, screenSize: number, scale: number): number {
  'worklet';

  return Math.max(0, (contentSize * scale - screenSize) / 2);
}

/**
 * Сдвиг после увеличения так, чтобы точка под пальцами осталась под ними.
 * `focal` — точка между пальцами, отсчитанная от центра экрана.
 */
export function zoomAround(
  focal: number,
  startTranslation: number,
  startScale: number,
  scale: number,
): number {
  'worklet';

  return focal - ((focal - startTranslation) * scale) / startScale;
}

/** Ограничить сдвиг краями; за краем — резина. */
export function clampWithRubber(value: number, bound: number, dimension: number): number {
  'worklet';

  if (value > bound) return bound + rubberBand(value - bound, dimension);
  if (value < -bound) return -bound + rubberBand(value + bound, dimension);

  return value;
}

/** Размер медиа, вписанного в экран целиком. */
export function fittedSize(
  media: { width: number | null; height: number | null },
  screen: { width: number; height: number },
): { width: number; height: number } {
  'worklet';

  if (!media.width || !media.height) return screen;

  const ratio = Math.min(screen.width / media.width, screen.height / media.height);

  return { width: media.width * ratio, height: media.height * ratio };
}

/**
 * На какую страницу встать после горизонтального жеста: протащил больше
 * четверти экрана или бросил — на соседнюю, иначе — назад.
 *
 * @param dragX сдвиг пальца по горизонтали, влево — отрицательный
 */
export function resolvePage(
  index: number,
  count: number,
  dragX: number,
  velocityX: number,
  width: number,
): number {
  'worklet';

  let next = index;

  if (dragX < -width * PAGE_DISTANCE_SHARE || velocityX < -VIEWER_FLING_VELOCITY) next = index + 1;
  else if (dragX > width * PAGE_DISTANCE_SHARE || velocityX > VIEWER_FLING_VELOCITY) next = index - 1;

  return Math.max(0, Math.min(count - 1, next));
}

/**
 * Закрыть ли просмотр после вертикального жеста — и в какую сторону.
 * `0` — не закрывать, медиа возвращается на место.
 */
export function resolveDismiss(dragY: number, velocityY: number, height: number): -1 | 0 | 1 {
  'worklet';

  const distance = height * DISMISS_DISTANCE_SHARE;

  if (dragY > distance || velocityY > VIEWER_FLING_VELOCITY) return 1;
  if (dragY < -distance || velocityY < -VIEWER_FLING_VELOCITY) return -1;

  return 0;
}

/** Фон светлеет по мере того, как медиа утаскивают: на трети экрана он уже почти прозрачен. */
export function dismissOpacity(dragY: number, height: number): number {
  'worklet';

  return Math.max(0, 1 - Math.abs(dragY) / (height / 3));
}
