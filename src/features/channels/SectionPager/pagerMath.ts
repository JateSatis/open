/** Бросок быстрее этого (dp/с) переключает раздел, сколько бы палец ни проехал. */
export const SECTION_FLING_VELOCITY = 500;

/** За краем первого и последнего раздела содержимое едет за пальцем лишь на эту долю. */
const EDGE_RESISTANCE = 0.25;

/**
 * Позиция пейджера под пальцем: `start` — раздел в начале жеста, `dragX` —
 * сдвиг пальца. За крайними разделами — с сопротивлением.
 */
export function dragPosition(start: number, dragX: number, width: number, count: number): number {
  'worklet';

  if (width <= 0) return start;

  const raw = start - dragX / width;
  const last = count - 1;

  if (raw < 0) return raw * EDGE_RESISTANCE;
  if (raw > last) return last + (raw - last) * EDGE_RESISTANCE;

  return raw;
}

/**
 * Куда докатиться после жеста. Бросок — к соседнему разделу в сторону броска;
 * медленный жест — к ближайшему разделу.
 */
export function resolveSection(position: number, velocityX: number, count: number): number {
  'worklet';

  const last = count - 1;
  let target: number;

  if (velocityX < -SECTION_FLING_VELOCITY) target = Math.floor(position) + 1;
  else if (velocityX > SECTION_FLING_VELOCITY) target = Math.ceil(position) - 1;
  else target = Math.round(position);

  return Math.max(0, Math.min(last, target));
}
