// Липкий корень раскрытого треда. Одна копия облачка корня лежит поверх
// списка в координатах содержимого и стоит под шапкой шита, пока тред
// листается; у дна треда уезжает вверх вместе с ним. Всё — по позиции
// скролла на UI-потоке и замеренным границам треда.

export type ThreadLayout = {
  /** Верх строки корня в содержимом списка. */
  rootTop: number;
  rootHeight: number;
  /** Низ последней строки треда в содержимом. */
  threadBottom: number;
};

/**
 * Низ шапки шита в координатах содержимого. Сама шапка — слой над списком:
 * едет вместе с подложкой (в содержимом это `travel`) и встаёт у верха окна,
 * когда шит доехал доверху.
 */
export function headerBottom(scroll: number, travel: number, headerHeight: number): number {
  'worklet';

  return Math.max(travel, scroll) + headerHeight;
}

/**
 * Верх копии корня в содержимом: на месте настоящего корня, пока он виден;
 * под шапкой, когда корень ушёл под неё; и не ниже, чем позволяет дно треда.
 */
export function stickyRootTop(layout: ThreadLayout, below: number): number {
  'worklet';

  return Math.min(Math.max(layout.rootTop, below), layout.threadBottom - layout.rootHeight);
}

/**
 * Копия видна, только когда корень ушёл под шапку: пока он на месте, его
 * рисует сама строка. Копия при этом стоит ровно над ним, поэтому смена
 * «строка ↔ копия» не видна.
 */
export function isRootStuck(layout: ThreadLayout, below: number): boolean {
  'worklet';

  return layout.rootTop < below && layout.threadBottom - layout.rootHeight > layout.rootTop;
}

/**
 * Скролл после скрытия треда с липкого корня: строки над корнем не
 * меняются, поэтому корень окажется там, где стояла копия, если сдвинуть
 * скролл на расстояние от копии до настоящего корня.
 */
export function scrollAfterCollapse(layout: ThreadLayout, scroll: number, below: number): number {
  return Math.max(0, scroll - (stickyRootTop(layout, below) - layout.rootTop));
}

/** Высота ответов треда — всё, что уходит из содержимого, когда тред закрывается. */
export function repliesHeight(layout: ThreadLayout): number {
  return layout.threadBottom - layout.rootTop - layout.rootHeight;
}
