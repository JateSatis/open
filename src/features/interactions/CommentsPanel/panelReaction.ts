import { requestClient } from '@/api/requestClient';
import type { QueryClient } from '@tanstack/react-query';

import { listMessageFragments, type Fragment, type FragmentRange } from '@/api/fragments';
import { PENDING_FRAGMENT } from '@/features/chats/fragments/clusterOptimism';
import { sendFragmentReaction } from '@/features/chats/fragments/fragmentReactions';
import { fragmentsKey, readMessageFragments } from '@/features/chats/fragments/useMessageFragments';
import { audienceOf } from '@/features/interactions/reactionState';

export type PanelReaction = {
  messageId: string;
  me: string;
  amMember: boolean;
  /** Мой фрагмент панели — куда встаёт новая реакция. */
  range: FragmentRange;
  /** Кластер, где моя реакция одна (`null` — вне кластеров); не знаем — `undefined`. */
  clusterId: string | null | undefined;
  /** Моя реакция здесь сейчас и фрагмент, на котором она стоит. */
  mine: string | null;
  myFragmentId: string | null;
};

/**
 * Где стоит моя реакция, которую снимают. Только что поставленная из панели
 * (`PENDING_FRAGMENT`) — на моём фрагменте её диапазона. Иначе — фрагмент из
 * кеша, а нет его там — из свежего списка: снимать наугад нельзя, база
 * ничего не снимет, а экран покажет снятой.
 */
async function holderRange(
  queryClient: QueryClient,
  panel: PanelReaction,
  api = requestClient(),
): Promise<FragmentRange | null> {
  if (!panel.myFragmentId || panel.myFragmentId === PENDING_FRAGMENT) return panel.range;

  const find = (fragments: readonly Fragment[] | undefined) =>
    fragments?.find((fragment) => fragment.id === panel.myFragmentId);
  const holder =
    find(readMessageFragments(queryClient, panel.messageId)) ??
    find(
      await queryClient
        .fetchQuery({
          queryKey: fragmentsKey(panel.messageId),
          queryFn: () => listMessageFragments(panel.messageId, api),
          staleTime: 0,
        })
        .catch(() => undefined),
    );

  return holder ? { start: holder.start, end: holder.end, text: holder.exactText } : null;
}

/**
 * Тап по реакции в панели кластера или области. Другая — встаёт на мой
 * фрагмент панели, и база снимает мою прежнюю в кластере. Моя — снимается
 * там, где стоит: это может быть мой другой фрагмент того же кластера.
 * Отдаёт, куда ушла реакция, — для события; `null` — снимать негде.
 */
export async function reactInPanel(
  queryClient: QueryClient,
  emoji: string,
  panel: PanelReaction,
  api = requestClient(),
): Promise<{ range: FragmentRange; removed: boolean } | null> {
  const removed = panel.mine === emoji;
  const range = removed ? await holderRange(queryClient, panel, api) : panel.range;

  if (!range) return null;

  sendFragmentReaction(queryClient, {
    messageId: panel.messageId,
    range,
    emoji: removed ? null : emoji,
    audience: audienceOf(panel.amMember),
    me: panel.me,
    clusterId: panel.clusterId,
  }, api);

  return { range, removed };
}
