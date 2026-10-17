import { BlendColor, Canvas, ImageShader, Path, Skia, type SkPath } from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { PixelRatio, StyleSheet } from 'react-native';
import { useSharedValue, withTiming } from 'react-native-reanimated';

import { patternTile, tileLine } from './patternTile';

import type { TextGeometry } from '../../../../../modules/text-geometry';

import type { ClusterPiece } from '@/features/chats/fragments/clusterGeometry';
import { ClusterLook, Sizes } from '@/theme';

export type PatternGroup = {
  clusterId: string;
  emoji: string;
  color: string;
  pieces: readonly ClusterPiece[];
};

export type ClusterPatternProps = {
  geometry: TextGeometry;
  groups: readonly PatternGroup[];
};

/** Доля радиуса для контрольных точек кубической дуги — четверть окружности. */
const KAPPA = 0.5523;

/** Куски кластера одним путём: скругления — только на логических концах, как у заливки. */
function piecesPath(pieces: readonly ClusterPiece[]): SkPath {
  const path = Skia.Path.Make();

  for (const { rect, first, last } of pieces) {
    const { x, y, width: w, height: h } = rect;
    const limit = Math.min(Sizes.clusterRadius, h / 2, w / 2);
    const l = first ? limit : 0;
    const r = last ? limit : 0;

    path.moveTo(x + l, y);
    path.lineTo(x + w - r, y);
    path.cubicTo(x + w - r + r * KAPPA, y, x + w, y + r - r * KAPPA, x + w, y + r);
    path.lineTo(x + w, y + h - r);
    path.cubicTo(x + w, y + h - r + r * KAPPA, x + w - r + r * KAPPA, y + h, x + w - r, y + h);
    path.lineTo(x + l, y + h);
    path.cubicTo(x + l - l * KAPPA, y + h, x, y + h - l + l * KAPPA, x, y + h - l);
    path.lineTo(x, y + l);
    path.cubicTo(x, y + l - l * KAPPA, x + l - l * KAPPA, y, x + l, y);
    path.close();
  }

  return path;
}

function PatternFill({
  group,
  lineHeight,
  top,
}: {
  group: PatternGroup;
  lineHeight: number;
  top: number;
}) {
  const ratio = PixelRatio.get();
  const tile = patternTile(group.emoji, lineHeight, ratio);
  // Плитка — в целых пикселях строки: точка в ней — чуть не `ratio`.
  const scale = tileLine(lineHeight, ratio) / lineHeight;
  const path = useMemo(() => piecesPath(group.pieces), [group.pieces]);
  const color = useSharedValue(group.color);

  useEffect(() => {
    color.value = withTiming(group.color, { duration: ClusterLook.toneTransition });
  }, [color, group.color]);

  if (!tile) return null;

  return (
    <Path path={path}>
      {/* Сетка привязана к тексту облачка, а не к куску: строки кластера
          продолжают один узор, пересчёт его не сдвигает. */}
      <ImageShader
        image={tile}
        tx="repeat"
        ty="repeat"
        fit="none"
        transform={[{ translateY: top }, { scale: 1 / scale }]}
      />
      <BlendColor color={color} mode="srcIn" />
    </Path>
  );
}

/**
 * Силуэты эмодзи-лидеров фоном внутри подсветки кластеров — один холст на
 * облачко, под текстом, без касаний.
 */
export function ClusterPattern({ geometry, groups }: ClusterPatternProps) {
  const first = geometry.lines[0];

  if (!first || groups.length === 0) return null;

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      {groups.map((group) => (
        <PatternFill
          key={`${group.clusterId}:${group.emoji}`}
          group={group}
          lineHeight={first.bottom - first.top}
          top={first.top}
        />
      ))}
    </Canvas>
  );
}
