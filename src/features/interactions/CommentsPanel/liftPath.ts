// Путь копии сообщения, поднятой над шитом комментариев, и прозрачность
// переписки под ним. Всё — функции от `dismissY` (насколько шит утащен вниз
// от рабочего положения): палец, пружина открытия и закрытие ведут одно и то
// же значение, и копия следует за шитом в обе стороны.

/** Сообщение выше своего места над шитом приходит на место к этой доле хода шита. */
const ABOVE_ARRIVAL_SHARE = 0.85;
/** Переписка проявляется за эту долю хода шита после того, как копия встала на место. */
const FADE_SHARE = 0.12;

export type LiftLayout = {
  /** Верх строки на её месте в переписке, в координатах окна. */
  origin: number;
  height: number;
  /** Верх копии над открытым шитом. */
  rest: number;
  /** Верх шита в рабочем положении. */
  sheetTop: number;
  sheetHeight: number;
  /** Зазор между низом сообщения и верхом шита. */
  gap: number;
};

/**
 * Где копия стоит над открытым шитом: низ над верхом шита с зазором. Высокое
 * сообщение поднимается, только пока его верх не упрётся в верх переписки;
 * остаток уходит под шит.
 */
export function liftRest(sheetTop: number, gap: number, height: number, areaTop: number): number {
  return Math.max(areaTop, sheetTop - gap - height);
}

/** Ход шита, на котором копия доходит до своего места. */
export function arrivalAt(layout: LiftLayout): number {
  'worklet';

  if (layout.origin >= layout.rest) {
    return Math.max(0, layout.origin + layout.height + layout.gap - layout.sheetTop);
  }

  return layout.sheetHeight * ABOVE_ARRIVAL_SHARE;
}

/**
 * Верх копии при этом ходе шита.
 *
 * - Место ниже положения над шитом: копия едет вровень с шитом и встаёт на
 *   месте, а шит уходит дальше. При открытии она ждёт, пока шит её догонит.
 * - Место выше: копия едет пропорционально ходу шита и приходит чуть раньше,
 *   чем шит скроется.
 */
export function liftTop(layout: LiftLayout, dismissY: number): number {
  'worklet';

  const { origin, rest } = layout;

  if (origin >= rest) {
    const withSheet = layout.sheetTop + dismissY - layout.gap - layout.height;

    return Math.min(origin, Math.max(rest, withSheet));
  }

  const progress = Math.min(Math.max(dismissY / arrivalAt(layout), 0), 1);

  return rest + (origin - rest) * progress;
}

/** Насколько копия «над шитом»: 1 — в рабочем положении, 0 — на своём месте. */
export function liftProgress(layout: LiftLayout, dismissY: number): number {
  'worklet';

  const arrival = arrivalAt(layout);

  if (arrival <= 0) return dismissY > 0 ? 0 : 1;

  return 1 - Math.min(Math.max(dismissY / arrival, 0), 1);
}

/**
 * Прозрачность остальной переписки. Пока копия не на месте, сообщений не
 * видно; дошла — они проявляются за короткий отрезок хода шита. Это та же
 * функция при открытии, поэтому, вернув шит вверх, их снова растворяют.
 *
 * @param layout `null` — сообщения над шитом нет: переписка просто растворяется
 *   вместе с выездом шита
 */
export function chatOpacity(
  layout: LiftLayout | null,
  dismissY: number,
  sheetHeight: number,
): number {
  'worklet';

  const arrival = layout ? arrivalAt(layout) : 0;
  const fade = sheetHeight * FADE_SHARE;

  return Math.min(Math.max((dismissY - arrival) / fade, 0), 1);
}
