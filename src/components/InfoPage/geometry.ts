// Раскладка шапки страницы информации — чистыми числами, без измерений:
// по ним в первом же кадре стоят фото, имя и кнопки, а списки вкладок
// знают, с какой высоты начинать.
//
// Одна величина прокрутки y (смещение активного списка) ведёт всё:
//   0                     — покой: фото во всю ширину, имя внизу слева на нём;
//   0 … collapse          — фото уезжает вверх вместе с содержимым; имя
//                           едет на нём, а подъезжая к панели, за
//                           `titleShift` перетекает в компактную плашку, и
//                           плашка проступает поверх уходящего фото;
//   дальше                — уезжают карточки, пока полоса вкладок не встанет
//                           под плашкой (stick), затем листается только вкладка.
// Выше покоя фото не раскрывается и в кружок не сжимается: потягивание вниз —
// просто край списка.

import { InfoPageSizes } from '@/theme';

// Ворклеты ниже — константы после сборки: объявлены до тех, кто их зовёт.
export function clamp01(value: number): number {
  'worklet';

  return Math.min(1, Math.max(0, value));
}

export function lerp(from: number, to: number, t: number): number {
  'worklet';

  return from + (to - from) * t;
}

export type InfoGeometry = {
  width: number;
  /** Низ верхней панели: под ней прилипает полоса вкладок. */
  barBottom: number;
  /** Высота фото (или блока с инициалами) — вся шапка в покое. */
  heroHeight: number;
  /** Верх имени на фото в покое. */
  nameTop: number;
  /** Верх ряда кнопок на фото в покое. */
  actionsTop: number;
  /** Ход, за который низ фото доходит до низа плашки. */
  collapse: number;
  /** С этого хода имя переезжает с фото в плашку… */
  titleStart: number;
  /** …и переезжает за столько. */
  titleShift: number;
};

export type GeometryInput = {
  width: number;
  insetTop: number;
  hasActions: boolean;
};

export function infoGeometry({ width, insetTop, hasActions }: GeometryInput): InfoGeometry {
  const S = InfoPageSizes;
  const barBottom = insetTop + S.barHeight;
  const actionsBlock = hasActions ? S.actionHeight + S.actionsGap : 0;
  const textBlock = S.nameLine * S.nameScaleExpanded + S.statusLine;
  // Фото — квадрат на всю ширину, но не короче того, что на нём стоит, с
  // запасом: на узком экране имя и кнопки не должны упираться в панель.
  const heroHeight = Math.max(
    width,
    barBottom + S.minPhotoClear + textBlock + actionsBlock + S.heroBottom,
  );
  const actionsTop = heroHeight - S.heroBottom - S.actionHeight;
  const nameTop = heroHeight - S.heroBottom - actionsBlock - textBlock;
  const collapse = Math.max(1, heroHeight - barBottom);
  // Имя начинает перетекать, когда до панели ему остаётся `titleShift`: под
  // стрелку «назад» оно не заезжает.
  const titleShift = S.titleShift;
  const titleStart = Math.max(0, nameTop - barBottom - titleShift);

  return {
    width,
    barBottom,
    heroHeight,
    nameTop,
    actionsTop,
    collapse,
    titleStart,
    titleShift,
  };
}

/**
 * Насколько имя переехало в плашку (0 — на фото, 1 — в плашке) при прокрутке `y`.
 */
export function titleProgress(y: number, geometry: InfoGeometry): number {
  'worklet';
  const { titleStart, titleShift } = geometry;

  return clamp01((y - titleStart) / titleShift);
}

/**
 * Куда доехать шапке после отпускания пальца: имя не остаётся на полпути
 * между фото и плашкой. Остальное — обычная прокрутка, её не трогаем.
 * null — доводка не нужна.
 */
export function snapTarget(y: number, geometry: InfoGeometry): number | null {
  const { titleStart, titleShift } = geometry;
  const end = titleStart + titleShift;

  if (y > titleStart && y < end) return y - titleStart < titleShift / 2 ? titleStart : end;

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
