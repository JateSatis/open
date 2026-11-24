import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { FragmentHeader } from './FragmentHeader';
import { reactInPanel } from './panelReaction';

import { trackClusterEvent } from '@/api/fragmentClusterEvents';
import type { FragmentCluster } from '@/api/fragmentClusters';
import { useMessageClusters } from '@/features/chats/fragments/useMessageClusters';
import { useMessageFragments } from '@/features/chats/fragments/useMessageFragments';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import type { FragmentPanelSubject } from '@/features/interactions/comments/commentsPanelStore';

export type ClusterHeaderProps = {
  messageId: string;
  chatId: string;
  subject: Extract<FragmentPanelSubject, { kind: 'cluster' }>;
  amMember: boolean;
  width: number;
};

const NONE = {};

/**
 * Шапка панели кластера: подсвеченный кусок и сводные реакции всех его
 * фрагментов, моя — отмечена (у человека в кластере она одна). Панель
 * держится за id кластера: пересчёт меняет счётчики, но не подменяет
 * кластер; пропал он из отображаемых (слился, уснул) — остаётся последнее
 * известное.
 */
export function ClusterHeader({ messageId, chatId, subject, amMember, width }: ClusterHeaderProps) {
  const api = useRequestClient();
  const queryClient = useQueryClient();
  const me = useCurrentUserId();
  // Живые счётчики: сигналы реакций и комментариев перечитывают и кластеры.
  useMessageFragments(messageId, true);
  const { data: clusters } = useMessageClusters({
    id: messageId,
    chatId,
    text: subject.messageText,
    always: true,
  });
  const found = clusters?.find((item) => item.id === subject.clusterId) ?? null;
  // Последнее известное — для кластера, который пересчёт убрал с показа.
  const [last, setLast] = useState<FragmentCluster | null>(found);
  const cluster = found ?? last;

  if (found && found !== last) setLast(found);

  const toggle = async (emoji: string) => {
    if (!me) return;

    const sent = await reactInPanel(queryClient, emoji, {
      messageId,
      me,
      amMember,
      range: subject.range,
      clusterId: subject.clusterId,
      mine: cluster?.mine ?? null,
      myFragmentId: cluster?.myFragmentId ?? null,
    }, api);

    if (!sent) return;

    trackClusterEvent({
      kind: 'cluster_reacted',
      messageId,
      decisionId: subject.decisionId,
      clusterId: subject.clusterId,
      rangeStart: sent.range.start,
      rangeEnd: sent.range.end,
      detail: { removed: sent.removed ? 1 : 0 },
    }, api);
  };

  return (
    <FragmentHeader
      quote={subject.range.text}
      memberReactions={cluster?.memberReactions ?? NONE}
      visitorReactions={cluster?.visitorReactions ?? NONE}
      mine={cluster?.mine ?? null}
      amMember={amMember}
      width={width}
      onToggle={toggle}
    />
  );
}
