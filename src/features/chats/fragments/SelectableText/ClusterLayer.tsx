import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ClusterFillPiece } from './ClusterFillPiece';
import { ClusterPattern, type PatternGroup } from './ClusterPattern';
import { styles } from './styles';

import type { TextGeometry } from '../../../../../modules/text-geometry';

import type { FragmentCluster } from '@/api/fragmentClusters';
import { clusterPieces } from '@/features/chats/fragments/clusterGeometry';
import { clusterTone, type ClusterTone } from '@/features/chats/fragments/reactionStyle';
import { useColorScheme } from '@/hooks/use-color-scheme';
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
 * Подсветка кластеров в режиме фрагментов: заливка по строкам под текстом —
 * цветом лидера реакций, с его силуэтами фоном, — и прозрачные места для
 * тапа поверх текста: тап по подсветке открывает панель кластера, а не
 * выводит облачко из режима.
 */
export function ClusterLayer({ geometry, clusters, isOwn, part, onOpen }: ClusterLayerProps) {
  const theme = useTheme();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const pieces = useMemo(
    () => clusterPieces(geometry, clusters, Sizes.clusterGap),
    [clusters, geometry],
  );
  const byId = useMemo(() => new Map(clusters.map((cluster) => [cluster.id, cluster])), [clusters]);
  const neutral = isOwn ? theme.clusterHighlightOnPrimary : theme.clusterHighlight;
  // Слою тапов цвет ни к чему.
  const tones = useMemo(
    () =>
      new Map<string, ClusterTone>(
        part === 'fill'
          ? clusters.map((cluster) => [cluster.id, clusterTone(cluster, scheme, isOwn, neutral)])
          : [],
      ),
    [clusters, isOwn, neutral, part, scheme],
  );
  const groups = useMemo(
    () =>
      clusters.flatMap((cluster): PatternGroup[] => {
        const pattern = tones.get(cluster.id)?.pattern;

        if (!pattern) return [];

        const own = pieces.filter((piece) => piece.clusterId === cluster.id);

        return own.length > 0
          ? [{ clusterId: cluster.id, emoji: pattern.emoji, color: pattern.color, pieces: own }]
          : [];
      }),
    [clusters, pieces, tones],
  );

  if (pieces.length === 0) return null;

  if (part === 'hits') {
    return (
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        {pieces.map(({ clusterId, rect }) => {
          const cluster = byId.get(clusterId);

          return (
            <Pressable
              key={`${clusterId}:${rect.y}`}
              testID={`cluster-hit-${clusterId}`}
              accessibilityRole="button"
              accessibilityLabel={`Обсуждение: ${cluster?.quote ?? ''}`}
              onPress={cluster && onOpen ? () => onOpen(cluster) : undefined}
              style={[styles.rect, { left: rect.x, top: rect.y, width: rect.width, height: rect.height }]}
            />
          );
        })}
      </View>
    );
  }

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((piece) => (
        <ClusterFillPiece
          key={`${piece.clusterId}:${piece.rect.y}`}
          piece={piece}
          color={tones.get(piece.clusterId)?.fill ?? neutral}
        />
      ))}
      <ClusterPattern geometry={geometry} groups={groups} />
    </View>
  );
}
