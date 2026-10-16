// Какие фрагменты входят в набор боковой панели — так же, как решает база
// (`fragment_set_ids`): кластер — его фрагменты, область — видимые, больше
// половины длины которых внутри неё. Клиенту это нужно, чтобы на глазах
// добавить в открытую панель свежий чужой комментарий.

import type { FragmentSet } from '@/api/comments';
import type { Fragment } from '@/api/fragments';

/** Больше половины длины диапазона — внутри области (ровно половина — нет). */
export function coversMoreThanHalf(
  range: { start: number; end: number },
  area: { start: number; end: number },
): boolean {
  const inside = Math.min(range.end, area.end) - Math.max(range.start, area.start);

  return inside > 0 && 2 * inside > range.end - range.start;
}

export function fragmentInSet(fragment: Fragment, set: FragmentSet): boolean {
  if (set.kind === 'cluster') return fragment.clusterId === set.clusterId;

  return !fragment.lost && coversMoreThanHalf(fragment, set);
}
