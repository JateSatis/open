// Какие фрагменты входят в набор боковой панели — так же, как решает база
// (`fragment_set_ids`): кластер — его фрагменты, область — видимые, больше
// половины длины которых внутри неё. Клиенту это нужно, чтобы на глазах
// добавить в открытую панель свежий чужой комментарий.

import type { FragmentSet } from '@/api/comments';
import type { Fragment } from '@/api/fragments';

export function fragmentInSet(fragment: Fragment, set: FragmentSet): boolean {
  if (set.kind === 'cluster') return fragment.clusterId === set.clusterId;
  if (fragment.lost) return false;

  const inside = Math.min(fragment.end, set.end) - Math.max(fragment.start, set.start);

  return inside > 0 && 2 * inside > fragment.end - fragment.start;
}
