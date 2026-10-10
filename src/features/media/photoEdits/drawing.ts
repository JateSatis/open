/**
 * Рисунок на фото — набор штрихов, а не картинка: из них слои собираются
 * заново для показа, плитки и запекания в любом разрешении.
 *
 * Все координаты и толщина — в долях ширины исходника, повёрнутого по EXIF,
 * как у обрезки (`crop.ts`). Рисунок привязан к фото, а не к рамке: правка
 * обрезки двигает, вертит и режет его вместе с фото.
 *
 * Слоёв два, и порядок сборки зафиксирован (см. `PhotoEdit`):
 * - размытие — размытое фото под мазками, лежит вместе с фото под цветом;
 * - линии — перо, стрелки, маркер, поверх, цветом не перекрашиваются.
 * Ластик и размытие действуют в обоих слоях — у их штриха место в обоих, по
 * порядку истории. Размытие замазывает и фото, и то, что нарисовано до него;
 * нарисованное после — поверх, чёткое. Ластик стирает всё нарисованное:
 * размытие → перо поверх → ластик по обоим → чистое фото.
 */
export type DrawBrush = 'pen' | 'arrow' | 'marker' | 'blur' | 'eraser';

export type DrawStroke = {
  brush: DrawBrush;
  /** Цвет линии с прозрачностью, `#rrggbbaa`. У размытия и ластика не используется. */
  color: string;
  /** Толщина в долях ширины исходника. */
  width: number;
  /** Точки пальца подряд: x0, y0, x1, y1… в долях ширины исходника. */
  points: number[];
};

export type PhotoDrawing = DrawStroke[];

export const DRAW_BRUSHES: readonly DrawBrush[] = ['pen', 'arrow', 'marker', 'blur', 'eraser'];

/** Кисти, у которых есть свой цвет. */
export type ColorBrush = 'pen' | 'arrow' | 'marker';

export function isColorBrush(brush: DrawBrush): brush is ColorBrush {
  'worklet';
  return brush === 'pen' || brush === 'arrow' || brush === 'marker';
}

/**
 * Маркер — полупрозрачный, как текстовыделитель. Прозрачность цвета кисти
 * умножается на неё: маркер с цветом в 50% — вдвое прозрачнее обычного.
 */
export const MARKER_OPACITY = 0.45;

/** Цвет кисти: `#rrggbbaa`, а сохранённый до прозрачности `#rrggbb` — непрозрачный. */
const INK_PATTERN = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

/** Цвет кисти в виде `#rrggbbaa` или `null`, если это не цвет. */
export function normalizeInk(value: unknown): string | null {
  if (typeof value !== 'string' || !INK_PATTERN.test(value)) return null;

  const lower = value.toLowerCase();

  return lower.length === 7 ? `${lower}ff` : lower;
}

function hexByte(value: number): string {
  'worklet';
  const byte = Math.round(Math.min(1, Math.max(0, value)) * 255);

  return (byte < 16 ? '0' : '') + byte.toString(16);
}

/** Цвет `#rrggbb…` и прозрачность 0…1 → цвет кисти `#rrggbbaa`. */
export function inkOf(rgb: string, alpha: number): string {
  'worklet';
  return `${rgb.slice(0, 7).toLowerCase()}${hexByte(alpha)}`;
}

/** Цвет из каналов 0…255 — `#rrggbb`. */
export function rgbHex(r: number, g: number, b: number): string {
  'worklet';
  return `#${hexByte(r / 255)}${hexByte(g / 255)}${hexByte(b / 255)}`;
}

/** Прозрачность цвета кисти, 0…1. */
export function inkAlpha(ink: string): number {
  'worklet';
  return ink.length === 9 ? parseInt(ink.slice(7, 9), 16) / 255 : 1;
}

/**
 * Цвет кисти → краска линии, `rgba(…)`: одна функция для штриха под пальцем
 * и для сборки слоя, поэтому запечённое совпадает с увиденным. У маркера
 * прозрачность цвета умножается на его собственную.
 */
export function brushPaintColor(ink: string, brush: DrawBrush): string {
  'worklet';
  const r = parseInt(ink.slice(1, 3), 16);
  const g = parseInt(ink.slice(3, 5), 16);
  const b = parseInt(ink.slice(5, 7), 16);
  const alpha = inkAlpha(ink) * (brush === 'marker' ? MARKER_OPACITY : 1);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
/**
 * Сила размытия — сигма гауссова размытия в долях ширины фото: на рабочей
 * копии в 1600 это ~56 px, под мазком не разобрать ни лица, ни номера, ни
 * текста. Одна на все штрихи: толщина кисти меняет ширину мазка, а не силу.
 * Края мазка чёткие.
 */
export const BLUR_SIGMA = 0.035;

/** Наконечник стрелки: длина пера — столько толщин линии, но не меньше доли ширины. */
const ARROW_HEAD_WIDTHS = 3.5;
const ARROW_HEAD_MIN = 0.02;
/** Угол пера наконечника к линии. */
const ARROW_HEAD_ANGLE = Math.PI / 6;

/**
 * Шаг сборки слоя: нарисовать линию, стереть или замазать — заменить
 * пиксели под мазком размытой копией того, что в слое уже есть (у слоя
 * размытия — размытым фото).
 */
export type DrawOp = { kind: 'paint' | 'erase' | 'blur'; stroke: DrawStroke };

/** Что рисует каждый слой и в каком порядке. */
export type DrawingPlan = { blur: DrawOp[]; lines: DrawOp[] };

/**
 * Раскладка штрихов по слоям. Ластик и размытие попадают в оба, на своё
 * место в истории: в слое размытия мазок кладёт размытое фото, в линиях —
 * замазывает уже нарисованное. Остальные кисти — только в линии. В слой,
 * где ещё ничего нет, ластик и замазывание не кладутся: им там нечего делать.
 */
export function drawingPlan(strokes: PhotoDrawing): DrawingPlan {
  const blur: DrawOp[] = [];
  const lines: DrawOp[] = [];

  for (const stroke of strokes) {
    if (stroke.brush === 'eraser') {
      if (blur.length > 0) blur.push({ kind: 'erase', stroke });
      if (lines.length > 0) lines.push({ kind: 'erase', stroke });
    } else if (stroke.brush === 'blur') {
      blur.push({ kind: 'blur', stroke });
      if (lines.length > 0) lines.push({ kind: 'blur', stroke });
    } else {
      lines.push({ kind: 'paint', stroke });
    }
  }

  return { blur, lines };
}

/** Есть хоть один мазок размытия — понадобится размытое фото. */
export function hasBlur(strokes: PhotoDrawing): boolean {
  return strokes.some((stroke) => stroke.brush === 'blur');
}

/**
 * Рисунок без пустых частей: ластик, перед которым ничего не нарисовано,
 * ничего и не стирает. Рисунок из одного ластика — то же, что его нет.
 * Полностью стёртые штрихи остаются: что стёрто попиксельно, по штрихам
 * не понять, а отмена должна вернуть ровно то, что было.
 */
export function normalizeDrawing(strokes: PhotoDrawing): PhotoDrawing {
  const first = strokes.findIndex((stroke) => stroke.brush !== 'eraser');

  if (first === -1) return [];

  return first === 0 ? strokes : strokes.slice(first);
}

/** Команды сглаженной линии — их одинаково выполняют живой показ и запекание. */
export type PathCommand =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'line'; x: number; y: number }
  | { kind: 'quad'; cx: number; cy: number; x: number; y: number };

/**
 * Сглаживание: квадратичные кривые через середины отрезков, точки пальца —
 * контрольные. Углов от редких событий касания нет, линия проходит через
 * первую и последнюю точку. Одна точка — точка (отрезок нулевой длины с
 * круглым концом).
 */
export function smoothPath(points: number[]): PathCommand[] {
  'worklet';
  const count = points.length / 2;

  if (count === 0) return [];

  const commands: PathCommand[] = [{ kind: 'move', x: points[0], y: points[1] }];

  if (count === 1) {
    commands.push({ kind: 'line', x: points[0], y: points[1] });
    return commands;
  }

  if (count === 2) {
    commands.push({ kind: 'line', x: points[2], y: points[3] });
    return commands;
  }

  commands.push({ kind: 'line', x: (points[0] + points[2]) / 2, y: (points[1] + points[3]) / 2 });

  for (let i = 1; i < count - 1; i++) {
    const x = points[i * 2];
    const y = points[i * 2 + 1];
    const nextX = points[i * 2 + 2];
    const nextY = points[i * 2 + 3];

    commands.push({ kind: 'quad', cx: x, cy: y, x: (x + nextX) / 2, y: (y + nextY) / 2 });
  }

  commands.push({ kind: 'line', x: points[count * 2 - 2], y: points[count * 2 - 1] });

  return commands;
}

/**
 * Наконечник стрелки: два пера от конца линии назад, по направлению
 * последнего участка. Направление берётся по точке, отстоящей от конца хотя
 * бы на длину пера, — дрожь пальца в последних точках его не сбивает.
 * Нет направления (точка) — наконечника нет.
 */
export function arrowHead(
  points: number[],
  width: number,
): { tipX: number; tipY: number; left: [number, number]; right: [number, number] } | null {
  'worklet';
  const count = points.length / 2;

  if (count < 2) return null;

  const tipX = points[count * 2 - 2];
  const tipY = points[count * 2 - 1];
  const length = Math.max(width * ARROW_HEAD_WIDTHS, ARROW_HEAD_MIN);
  let fromX = points[0];
  let fromY = points[1];

  for (let i = count - 2; i >= 0; i--) {
    const x = points[i * 2];
    const y = points[i * 2 + 1];

    if (Math.hypot(tipX - x, tipY - y) >= length) {
      fromX = x;
      fromY = y;
      break;
    }
  }

  const dx = tipX - fromX;
  const dy = tipY - fromY;
  const distance = Math.hypot(dx, dy);

  if (distance === 0) return null;

  const back = Math.atan2(-dy, -dx);
  const side = (angle: number): [number, number] => [
    tipX + Math.cos(angle) * length,
    tipY + Math.sin(angle) * length,
  ];

  return {
    tipX,
    tipY,
    left: side(back - ARROW_HEAD_ANGLE),
    right: side(back + ARROW_HEAD_ANGLE),
  };
}
