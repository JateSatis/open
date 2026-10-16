import type { ReactNode } from 'react';
import { View, type Text } from 'react-native';

import { ClusterLayer } from './ClusterLayer';

import { openClusterPanel } from '@/features/chats/fragments/openFragmentPanel';
import { useClusterHighlight } from '@/features/chats/fragments/useClusterHighlight';

export type ClusterModeProps = {
  children: ReactNode;
  textRef: { current: Text | null };
  text: string;
  isOwn: boolean;
  rowKey: string;
  messageId: string;
  chatId: string;
  amMember: boolean;
  fragmentsCount: number;
};

/**
 * Текст облачка в режиме фрагментов: под ним — подсветка кластеров, поверх —
 * места для тапа по ней. Монтируется только у облачка в режиме: облачка
 * списка кластеры не грузят и на панель не подписываются.
 */
export function ClusterMode({
  children,
  textRef,
  text,
  isOwn,
  rowKey,
  messageId,
  chatId,
  amMember,
  fragmentsCount,
}: ClusterModeProps) {
  const { geometry, clusters } = useClusterHighlight({
    rowKey,
    ref: textRef,
    text,
    messageId,
    chatId,
    fragmentsCount,
  });

  return (
    <View>
      {geometry ? (
        <ClusterLayer geometry={geometry} clusters={clusters} isOwn={isOwn} part="fill" />
      ) : null}
      {children}
      {geometry ? (
        <ClusterLayer
          geometry={geometry}
          clusters={clusters}
          isOwn={isOwn}
          part="hits"
          onOpen={(cluster) =>
            openClusterPanel({ rowKey, messageId, chatId, amMember, text }, cluster)
          }
        />
      ) : null}
    </View>
  );
}
