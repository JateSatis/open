import { StyleSheet } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import { lerp, titleProgress, type InfoGeometry } from './geometry';
import type { InfoStatus } from './types';

import { useTheme } from '@/hooks/use-theme';
import { InfoPageSizes, Spacing, Typography } from '@/theme';

const S = InfoPageSizes;
/** Тень текста вне фото не нужна — гасим её прозрачным цветом. */
const TRANSPARENT = 'transparent';

export type InfoTitleProps = {
  geometry: InfoGeometry;
  insetTop: number;
  scrollY: SharedValue<number>;
  /** 0…1 — полоса вкладок прилипла: под именем сводка вкладки, а не статус. */
  stuck: SharedValue<number>;
  title: string;
  status: InfoStatus | null;
  summary: string;
};

/**
 * Имя и статус. В покое — внизу слева на фото, крупно и белым; едут вверх
 * вместе с фото, а на последнем отрезке перетекают в компактную плашку,
 * меняя размер и цвет. Одна анимация ведёт оба положения.
 */
export function InfoTitle({
  geometry,
  insetTop,
  scrollY,
  stuck,
  title,
  status,
  summary,
}: InfoTitleProps) {
  const theme = useTheme();
  const { width, nameTop } = geometry;
  const maxWidth = width - Spacing.three * 2;
  // Имя на фото увеличено: в увеличенном виде оно тоже не шире строки.
  const nameMaxWidth = maxWidth / S.nameScaleExpanded;

  const statusColor = status?.accent ? theme.primary : theme.textSecondary;
  const compactTop =
    insetTop +
    (S.barHeight - (S.nameLine * S.nameScaleCompact + S.statusLine * S.statusScaleCompact)) / 2;

  const position = (y: number) => {
    'worklet';
    const t = titleProgress(y, geometry);
    const nameScale = lerp(S.nameScaleExpanded, S.nameScaleCompact, t);
    const nameY = lerp(nameTop - y, compactTop, t);

    return {
      t,
      x: lerp(Spacing.three, S.barTitleLeft, t),
      nameY,
      nameScale,
      statusY: nameY + S.nameLine * nameScale,
      statusScale: lerp(1, S.statusScaleCompact, t),
    };
  };

  const nameStyle = useAnimatedStyle(() => {
    const at = position(scrollY.value);

    return {
      color: interpolateColor(at.t, [0, 1], [theme.textOnMedia, theme.text]),
      textShadowColor: interpolateColor(at.t, [0, 1], [theme.mediaScrim, TRANSPARENT]),
      transform: [{ translateX: at.x }, { translateY: at.nameY }, { scale: at.nameScale }],
    };
  });

  const statusStyle = useAnimatedStyle(() => {
    const at = position(scrollY.value);

    return {
      opacity: 1 - stuck.value,
      color: interpolateColor(at.t, [0, 1], [theme.textOnMedia, statusColor]),
      textShadowColor: interpolateColor(at.t, [0, 1], [theme.mediaScrim, TRANSPARENT]),
      transform: [{ translateX: at.x }, { translateY: at.statusY }, { scale: at.statusScale }],
    };
  });

  const summaryStyle = useAnimatedStyle(() => {
    const at = position(scrollY.value);

    return {
      opacity: stuck.value,
      transform: [
        { translateX: S.barTitleLeft },
        { translateY: at.statusY },
        { scale: at.statusScale },
      ],
    };
  });

  return (
    <>
      <Animated.Text
        testID="info-title"
        numberOfLines={1}
        style={[styles.line, styles.name, styles.onPhoto, { maxWidth: nameMaxWidth }, nameStyle]}
      >
        {title}
      </Animated.Text>
      {status ? (
        <Animated.Text
          testID="info-status"
          numberOfLines={1}
          style={[styles.line, styles.status, styles.onPhoto, { maxWidth }, statusStyle]}
        >
          {status.text}
        </Animated.Text>
      ) : null}
      <Animated.Text
        testID="info-summary"
        numberOfLines={1}
        style={[
          styles.line,
          styles.status,
          { maxWidth: maxWidth - S.barTitleLeft, color: theme.textSecondary },
          summaryStyle,
        ]}
      >
        {summary}
      </Animated.Text>
    </>
  );
}

const styles = StyleSheet.create({
  line: {
    position: 'absolute',
    left: 0,
    top: 0,
    transformOrigin: 'left top',
  },
  name: {
    ...Typography.infoName,
  },
  onPhoto: {
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  status: {
    ...Typography.small,
    lineHeight: S.statusLine,
  },
});
