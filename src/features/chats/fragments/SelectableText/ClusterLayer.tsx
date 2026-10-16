import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { styles } from './styles';

import type { TextGeometry } from '../../../../../modules/text-geometry';

import type { FragmentCluster } from '@/api/fragmentClusters';
import { clusterPieces } from '@/features/chats/fragments/clusterGeometry';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export type ClusterLayerProps = {
  geometry: TextGeometry;
  clusters: readonly FragmentCluster[];
  isOwn: boolean;
  /** `fill` — заливка под текстом, `hits` — тап по ней поверх текста. */
  part: 'fill' | 'hits';
  onOpen?: (cluster: FragmentCluster) => void;
};

/**
 * Подсветка кластеров в режиме фрагментов: нейтральная заливка по строкам
 * под текстом и прозрачные места для тапа поверх него — тап по подсветке
 * открывает панель кластера, а не выводит облачко из режима.
 */
export function ClusterLayer({ geometry, clusters, isOwn, part, onOpen }: ClusterLayerProps) {
  const theme = useTheme();
  const pieces = useMemo(
    () => clusterPieces(geometry, clusters, Sizes.clusterGap),
    [clusters, geometry],
  );
  const byId = useMemo(() => new Map(clusters.map((cluster) => [cluster.id, cluster])), [clusters]);

  if (pieces.length === 0) return null;

  return (
    <View pointerEvents={part === 'fill' ? 'none' : 'box-none'} style={StyleSheet.absoluteFill}>
      {pieces.map(({ clusterId, rect, first, last }) => {
        const place = {
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
        };

        if (part === 'hits') {
          const cluster = byId.get(clusterId);

          return (
            <Pressable
              key={`${clusterId}:${rect.y}`}
              testID={`cluster-hit-${clusterId}`}
              accessibilityRole="button"
              accessibilityLabel={`Обсуждение: ${cluster?.quote ?? ''}`}
              onPress={cluster && onOpen ? () => onOpen(cluster) : undefined}
              style={[styles.rect, place]}
            />
          );
        }

        return (
          <View
            key={`${clusterId}:${rect.y}`}
            testID="cluster-highlight"
            style={[
              styles.rect,
              place,
              first && styles.clusterStart,
              last && styles.clusterEnd,
              { backgroundColor: isOwn ? theme.clusterHighlightOnPrimary : theme.clusterHighlight },
            ]}
          />
        );
      })}
    </View>
  );
}
