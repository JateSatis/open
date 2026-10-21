// Автопрокрутка переписки, пока тянут выделение: палец у верхнего или нижнего
// края списка — переписка едет сама, выделение растёт по подъезжающему тексту.
// Список знает экран переписки, выделение — строка: экран кладёт сюда, как
// себя прокрутить, а протяжка (`fragmentSelection`) зовёт.

export type SelectionScroller = {
  /** Видимая часть переписки в окне: верх и низ. */
  measure: () => Promise<{ top: number; bottom: number } | null>;
  /**
   * Сдвинуть содержимое на экране: больше нуля — вниз (открывается то, что
   * выше), меньше — вверх. Отдаёт, на сколько сдвинулось на самом деле:
   * у края истории — меньше или ноль.
   */
  scrollBy: (delta: number) => number;
};

let current: SelectionScroller | null = null;

/**
 * Переписка на виду кладёт свою прокрутку. В стеке бывает два экрана чата —
 * кладёт тот, что в фокусе; отдаёт снятие.
 */
export function registerSelectionScroller(scroller: SelectionScroller): () => void {
  current = scroller;

  return () => {
    if (current === scroller) current = null;
  };
}

export function selectionScroller(): SelectionScroller | null {
  return current;
}

/** Полоса у края списка, где палец включает автопрокрутку. */
export const AUTO_SCROLL_EDGE = 64;
/** Скорость у самой границы полосы и у края списка (и за ним), dp/с. */
const MIN_SPEED = 120;
const MAX_SPEED = 1500;

/**
 * Скорость автопрокрутки для пальца на высоте `y` (окно): больше нуля —
 * содержимое едет вниз (палец у верхнего края), меньше — вверх, ноль — палец
 * не у края. Чем ближе к краю, тем быстрее — квадратом, чтобы у границы
 * полосы прокрутка начиналась мягко.
 */
export function edgeSpeed(y: number, frame: { top: number; bottom: number }): number {
  const zone = Math.min(AUTO_SCROLL_EDGE, (frame.bottom - frame.top) / 3);

  if (zone <= 0) return 0;

  const speedAt = (depth: number) => {
    const share = Math.min(1, depth / zone);

    return MIN_SPEED + (MAX_SPEED - MIN_SPEED) * share * share;
  };

  if (y < frame.top + zone) return speedAt(frame.top + zone - y);
  if (y > frame.bottom - zone) return -speedAt(y - (frame.bottom - zone));

  return 0;
}

/**
 * Насколько ещё можно ехать, чтобы текст не уехал дальше нужного: вниз — пока
 * его начало не покажется из-под верхней полосы, вверх — пока конец не
 * поднимется над нижней. Дальше выделению расти некуда.
 */
export function scrollRoom(
  speed: number,
  text: { top: number; bottom: number },
  frame: { top: number; bottom: number },
): number {
  const zone = Math.min(AUTO_SCROLL_EDGE, (frame.bottom - frame.top) / 3);

  if (speed > 0) return Math.max(0, frame.top + zone - text.top);
  if (speed < 0) return Math.min(0, frame.bottom - zone - text.bottom);

  return 0;
}
