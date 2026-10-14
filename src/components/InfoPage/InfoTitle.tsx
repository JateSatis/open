import { useState } from 'react';
import { StyleSheet, type LayoutChangeEvent } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import { clamp01, lerp, type InfoGeometry } from './geometry';
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
  hasActions: boolean;
};

/**
 * Имя и статус. Одни и те же строки едут из-под аватарки в панель (схлопывание)
 * и в левый нижний угол фото (раскрытие), меняя размер и цвет. Строки
 * выровнены по левому краю, а «по центру» — сдвиг на половину своей ширины:
 * так одна анимация ведёт их во все три положения.
 */
export function InfoTitle({
  geometry,
  insetTop,
  scrollY,
  stuck,
  title,
  status,
  summary,
  hasActions,
}: InfoTitleProps) {
  const theme = useTheme();
  const [nameWidth, setNameWidth] = useState(0);
  const [statusWidth, setStatusWidth] = useState(0);
  const { width, expand, collapse, nameTop, expandedHeight } = geometry;
  const maxWidth = width - Spacing.three * 2;

  const statusColor = status?.accent ? theme.primary : theme.textSecondary;
  const photoNameTop =
    expandedHeight -
    S.heroBottom -
    (hasActions ? S.actionHeight + S.actionsGap : 0) -
    (S.nameLine * S.nameScaleExpanded + S.statusLine);
  const compactTop =
    insetTop +
    (S.barHeight - (S.nameLine * S.nameScaleCompact + S.statusLine * S.statusScaleCompact)) / 2;

  const nameStyle = useAnimatedStyle(() => {
    const y = scrollY.value;
    const q = expand > 0 ? clamp01((expand - y) / expand) : 0;
    const p = clamp01((y - expand) / collapse);
    const centered = (width - Math.min(nameWidth, maxWidth)) / 2;
    const x = q > 0 ? lerp(centered, Spacing.three, q) : lerp(centered, S.barTitleLeft, p);
    const top = q > 0 ? lerp(nameTop, photoNameTop, q) : lerp(nameTop, compactTop, p);
    const scale = q > 0 ? lerp(1, S.nameScaleExpanded, q) : lerp(1, S.nameScaleCompact, p);

    return {
      color: interpolateColor(q, [0, 1], [theme.text, theme.textOnMedia]),
      textShadowColor: interpolateColor(q, [0, 1], [TRANSPARENT, theme.mediaScrim]),
      transform: [{ translateX: x }, { translateY: top }, { scale }],
    };
  });

  const statusPosition = (y: number, ownWidth: number) => {
    'worklet';
    const q = expand > 0 ? clamp01((expand - y) / expand) : 0;
    const p = clamp01((y - expand) / collapse);
    const centered = (width - Math.min(ownWidth, maxWidth)) / 2;
    const nameScale = q > 0 ? lerp(1, S.nameScaleExpanded, q) : lerp(1, S.nameScaleCompact, p);
    const nameY = q > 0 ? lerp(nameTop, photoNameTop, q) : lerp(nameTop, compactTop, p);

    return {
      x: q > 0 ? lerp(centered, Spacing.three, q) : lerp(centered, S.barTitleLeft, p),
      y: nameY + S.nameLine * nameScale,
      scale: q > 0 ? 1 : lerp(1, S.statusScaleCompact, p),
      q,
    };
  };

  const statusStyle = useAnimatedStyle(() => {
    const at = statusPosition(scrollY.value, statusWidth);

    return {
      opacity: 1 - stuck.value,
      color: interpolateColor(at.q, [0, 1], [statusColor, theme.textOnMedia]),
      textShadowColor: interpolateColor(at.q, [0, 1], [TRANSPARENT, theme.mediaScrim]),
      transform: [{ translateX: at.x }, { translateY: at.y }, { scale: at.scale }],
    };
  });

  const summaryStyle = useAnimatedStyle(() => {
    const at = statusPosition(scrollY.value, 0);

    return {
      opacity: stuck.value,
      transform: [{ translateX: S.barTitleLeft }, { translateY: at.y }, { scale: at.scale }],
    };
  });

  const measure = (set: (value: number) => void) => (event: LayoutChangeEvent) =>
    set(event.nativeEvent.layout.width);

  return (
    <>
      <Animated.Text
        testID="info-title"
        numberOfLines={1}
        onLayout={measure(setNameWidth)}
        style={[styles.line, styles.name, styles.onPhoto, { maxWidth }, nameStyle]}
      >
        {title}
      </Animated.Text>
      {status ? (
        <Animated.Text
          testID="info-status"
          numberOfLines={1}
          onLayout={measure(setStatusWidth)}
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
