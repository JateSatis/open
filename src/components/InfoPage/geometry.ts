// Раскладка шапки страницы информации — чистыми числами, без измерений:
// по ним в первом же кадре стоят аватарка, имя и кнопки, а списки вкладок
// знают, с какой высоты начинать.
//
// Одна величина прокрутки y (смещение активного списка) ведёт всё:
//   0 … expand          — фото раскрыто на всю ширину (0) … обычный круг;
//   expand … +collapse  — шапка схлопывается в компактный заголовок;
//   дальше              — уезжают карточки, пока полоса вкладок не встанет
//                         под панелью (stick), затем листается только вкладка.
// Покой страницы — y = expand: раскрытие фото — это прокрутка списка вниз за
// его обычное начало, и жесты не спорят друг с другом.

import { InfoPageSizes } from '@/theme';

export type InfoGeometry = {
  width: number;
  /** Низ верхней панели: под ней прилипает полоса вкладок. */
  barBottom: number;
  avatarTop: number;
  nameTop: number;
  /** Верх ряда кнопок в обычном состоянии. */
  actionsTop: number;
  /** Высота шапки в обычном состоянии. */
  heroHeight: number;
  /** Высота раскрытого фото; в раскладке шапка всегда этой высоты. */
  expandedHeight: number;
  /** Ход раскрытия: на столько список уходит вниз от покоя. 0 — раскрытия нет. */
  expand: number;
  /** Ход схлопывания шапки в компактный заголовок. */
  collapse: number;
  /** Порог раскрытия: дотянул до него — фото остаётся раскрытым. */
  expandThreshold: number;
};

export type GeometryInput = {
  width: number;
  insetTop: number;
  hasActions: boolean;
  /** Есть фото, которое можно раскрыть. */
  expandable: boolean;
};

export function infoGeometry({
  width,
  insetTop,
  hasActions,
  expandable,
}: GeometryInput): InfoGeometry {
  const S = InfoPageSizes;
  const barBottom = insetTop + S.barHeight;
  const avatarTop = barBottom;
  const nameTop = avatarTop + S.avatar + S.nameGap;
  const textBottom = nameTop + S.nameLine + S.statusLine;
  const actionsTop = textBottom + S.actionsGap;
  const heroHeight = (hasActions ? actionsTop + S.actionHeight : textBottom) + S.heroBottom;
  // Раскрытое фото — примерно квадрат на всю ширину, но не короче обычной
  // шапки с запасом: на узком экране раскрытие всё равно должно читаться.
  const expandedHeight = expandable ? Math.max(width, heroHeight + S.minExpand) : heroHeight;
  const expand = expandedHeight - heroHeight;

  return {
    width,
    barBottom,
    avatarTop,
    nameTop,
    actionsTop,
    heroHeight,
    expandedHeight,
    expand,
    collapse: Math.max(1, heroHeight - barBottom),
    expandThreshold: Math.min(expand * 0.4, S.expandThreshold),
  };
}

/**
 * Куда доехать шапке после отпускания пальца: из середины раскрытия — в
 * раскрытое или обычное, из середины схлопывания — в ближайшее крайнее.
 * null — доводка не нужна.
 */
export function snapTarget(y: number, geometry: InfoGeometry, wasExpanded: boolean): number | null {
  const { expand, collapse, expandThreshold } = geometry;

  if (expand > 0 && y > 0 && y < expand) {
    // Из раскрытого сворачивается тоже по порогу — со стороны раскрытого.
    const pulled = expand - y;

    if (wasExpanded) return y < expandThreshold ? 0 : expand;

    return pulled >= expandThreshold ? 0 : expand;
  }

  if (y > expand && y < expand + collapse) {
    return y - expand < collapse / 2 ? expand : expand + collapse;
  }

  return null;
}

/**
 * Смещение, с которого открыть соседнюю вкладку, чтобы шапка при
 * переключении не прыгнула: пока полоса вкладок не прилипла, вкладка стоит
 * там же, где текущая; прилипла — вкладка остаётся на своём месте, если оно
 * не выше точки прилипания.
 */
export function syncedOffset(headerY: number, ownY: number, stickY: number): number {
  if (headerY < stickY) return headerY;

  return Math.max(ownY, stickY);
}

export function clamp01(value: number): number {
  'worklet';

  return Math.min(1, Math.max(0, value));
}

export function lerp(from: number, to: number, t: number): number {
  'worklet';

  return from + (to - from) * t;
}
