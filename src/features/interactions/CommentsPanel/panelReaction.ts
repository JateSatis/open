import type { QueryClient } from '@tanstack/react-query';

import type { Fragment, FragmentRange } from '@/api/fragments';
import { sendFragmentReaction } from '@/features/chats/fragments/fragmentReactions';
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
  fragments: readonly Fragment[] | undefined;
};

/**
 * Тап по реакции в панели кластера или области. Другая — встаёт на мой
 * фрагмент панели, и база снимает мою прежнюю в кластере. Моя — снимается
 * там, где стоит: это может быть мой другой фрагмент того же кластера.
 * Отдаёт, куда ушла реакция, — для события.
 */
export function reactInPanel(
  queryClient: QueryClient,
  emoji: string,
  panel: PanelReaction,
): { range: FragmentRange; removed: boolean } {
  const removed = panel.mine === emoji;
  const holder = removed ? panel.fragments?.find((f) => f.id === panel.myFragmentId) : undefined;
  const range = holder ? { start: holder.start, end: holder.end, text: holder.exactText } : panel.range;

  sendFragmentReaction(queryClient, {
    messageId: panel.messageId,
    range,
    emoji: removed ? null : emoji,
    audience: audienceOf(panel.amMember),
    me: panel.me,
    clusterId: panel.clusterId,
  });

  return { range, removed };
}
