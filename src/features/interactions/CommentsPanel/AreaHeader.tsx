import { useQuery, useQueryClient } from '@tanstack/react-query';

import { FragmentHeader } from './FragmentHeader';
import { reactInPanel } from './panelReaction';

import { trackClusterEvent } from '@/api/fragmentClusterEvents';
import { getAreaSummary } from '@/api/fragmentClusters';
import { areaKey } from '@/features/chats/fragments/clusterKeys';
import { useMessageFragments } from '@/features/chats/fragments/useMessageFragments';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import type { FragmentPanelSubject } from '@/features/interactions/comments/commentsPanelStore';

export type AreaHeaderProps = {
  messageId: string;
  subject: Extract<FragmentPanelSubject, { kind: 'area' }>;
  amMember: boolean;
  width: number;
};

const NONE = {};

/**
 * Шапка панели выделенной области: выделенный кусок и сумма реакций
 * фрагментов, больше половины которых внутри. Отмечена моя реакция в том
 * кластере, куда попадёт мой фрагмент области, — именно её заменит тап по
 * другой. Пустая область — цитата и «+».
 */
export function AreaHeader({ messageId, subject, amMember, width }: AreaHeaderProps) {
  const queryClient = useQueryClient();
  const me = useCurrentUserId();
  const { range } = subject;
  // Живые счётчики: сигналы реакций и комментариев перечитывают и сводку.
  useMessageFragments(messageId, true);
  const { data: area } = useQuery({
    queryKey: areaKey(messageId, range.start, range.end),
    queryFn: () => getAreaSummary(messageId, range.start, range.end),
    staleTime: 30_000,
  });

  const toggle = async (emoji: string) => {
    if (!me) return;

    const sent = await reactInPanel(queryClient, emoji, {
      messageId,
      me,
      amMember,
      range,
      clusterId: area ? area.myClusterId : undefined,
      mine: area?.mine ?? null,
      myFragmentId: area?.myFragmentId ?? null,
    });

    if (!sent) return;

    trackClusterEvent({
      kind: 'cluster_reacted',
      messageId,
      clusterId: area?.myClusterId ?? null,
      rangeStart: sent.range.start,
      rangeEnd: sent.range.end,
      detail: { removed: sent.removed ? 1 : 0, area: 1 },
    });
  };

  return (
    <FragmentHeader
      quote={range.text}
      memberReactions={area?.memberReactions ?? NONE}
      visitorReactions={area?.visitorReactions ?? NONE}
      mine={area?.mine ?? null}
      amMember={amMember}
      width={width}
      onToggle={toggle}
    />
  );
}
