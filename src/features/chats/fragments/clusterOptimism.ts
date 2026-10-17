// Моя реакция в кластере — сразу в сводках, которые видны в панелях: у
// человека в кластере одна живая реакция, и новая снимает прежнюю. Так
// решает база; здесь — чтобы в панели прежняя погасла, а новая загорелась
// сразу, а не после перечитывания. Сверка — перечитыванием после ответа базы.

import type { QueryClient } from '@tanstack/react-query';

import type { AreaSummary, FragmentCluster } from '@/api/fragmentClusters';
import type { ReactionAudience, ReactionCounts } from '@/api/reactionCounts';
import { clustersKeyOf } from '@/features/chats/fragments/clusterKeys';
import { coversMoreThanHalf } from '@/features/chats/fragments/fragmentSets';
import { dominantReaction } from '@/features/chats/fragments/reactionStyle';

type Row = 'memberReactions' | 'visitorReactions';

/**
 * Где теперь моя реакция, пока база не ответила: на моём фрагменте ровно
 * этого диапазона, чей id ещё неизвестен. Снять её — по диапазону.
 */
export const PENDING_FRAGMENT = 'local:pending';

export function shiftCount(
  counts: ReactionCounts,
  emoji: string | null | undefined,
  delta: number,
): ReactionCounts {
  if (!emoji) return counts;

  const next = { ...counts, [emoji]: (counts[emoji] ?? 0) + delta };

  if (next[emoji] <= 0) delete next[emoji];

  return next;
}

export type ClusterReactionPatch = {
  messageId: string;
  /**
   * Кластер, где моя реакция меняется; `null` — фрагмент вне кластеров (его
   * видит только панель области ровно этого диапазона).
   */
  clusterId: string | null;
  /** Новая моя реакция; `null` — снята. */
  emoji: string | null;
  /** Диапазон моего фрагмента, на который она ставится (code points). */
  range: { start: number; end: number };
  audience: ReactionAudience;
};

export function patchClusterReaction(queryClient: QueryClient, patch: ClusterReactionPatch) {
  const { messageId, clusterId, emoji, range, audience } = patch;
  const row: Row = audience === 'member' ? 'memberReactions' : 'visitorReactions';
  const holder = emoji ? PENDING_FRAGMENT : null;

  for (const [key, data] of queryClient.getQueriesData<FragmentCluster[] | AreaSummary>({
    queryKey: clustersKeyOf(messageId),
  })) {
    if (Array.isArray(data)) {
      if (!clusterId) continue;

      queryClient.setQueryData<FragmentCluster[]>(key, (clusters) =>
        clusters?.map((cluster) => {
          if (cluster.id !== clusterId || cluster.mine === emoji) return cluster;

          const next = {
            ...cluster,
            [row]: shiftCount(shiftCount(cluster[row], cluster.mine, -1), emoji, 1),
            reactionsCount: cluster.reactionsCount - (cluster.mine ? 1 : 0) + (emoji ? 1 : 0),
            mine: emoji,
            myFragmentId: holder,
          };

          // Цвет подсветки — сразу по тапу, тем же правилом, что в базе.
          return {
            ...next,
            dominant: dominantReaction([next.memberReactions, next.visitorReactions], cluster.dominant),
          };
        }),
      );
      continue;
    }

    // Сводка области: [..., 'area', start, end].
    const [, , , start, end] = key as readonly unknown[];

    if (!data || data.myClusterId !== clusterId || data.mine === emoji) continue;
    if (typeof start !== 'number' || typeof end !== 'number') continue;
    if (!clusterId && (start !== range.start || end !== range.end)) continue;

    const before = data.myFragmentId && data.fragmentIds.includes(data.myFragmentId) ? data.mine : null;
    const inside = Boolean(emoji) && coversMoreThanHalf(range, { start, end });
    const fragmentIds = data.fragmentIds.filter((id) => id !== data.myFragmentId);

    queryClient.setQueryData<AreaSummary>(key, {
      ...data,
      [row]: shiftCount(shiftCount(data[row], before, -1), inside ? emoji : null, 1),
      reactionsCount: data.reactionsCount - (before ? 1 : 0) + (inside ? 1 : 0),
      fragmentIds: inside ? [...fragmentIds, PENDING_FRAGMENT] : fragmentIds,
      mine: emoji,
      myFragmentId: holder,
    });
  }
}
