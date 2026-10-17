import { useEffect } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { styles } from './styles';

import type { ClusterPiece } from '@/features/chats/fragments/clusterGeometry';
import { ClusterLook } from '@/theme';

export type ClusterFillPieceProps = {
  piece: ClusterPiece;
  color: string;
};

/** Кусок заливки кластера: смена лидера перетекает в новый цвет, а не прыгает. */
export function ClusterFillPiece({ piece: { rect, first, last }, color }: ClusterFillPieceProps) {
  const tone = useSharedValue(color);

  useEffect(() => {
    tone.value = withTiming(color, { duration: ClusterLook.toneTransition });
  }, [color, tone]);

  const animated = useAnimatedStyle(() => ({ backgroundColor: tone.value }));

  return (
    <Animated.View
      testID="cluster-highlight"
      style={[
        styles.rect,
        { left: rect.x, top: rect.y, width: rect.width, height: rect.height },
        first && styles.clusterStart,
        last && styles.clusterEnd,
        animated,
      ]}
    />
  );
}
