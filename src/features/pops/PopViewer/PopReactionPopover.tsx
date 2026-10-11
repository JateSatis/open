import { useMemo, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import type { PopReactions } from '@/api/pops';
import { pickerGeometry, ReactionPicker } from '@/features/interactions/ReactionPicker';
import { popPickerOptions } from '@/features/pops/popReactions';
import { Sizes, Spacing } from '@/theme';

const FADE_MS = 150;

/** Где кнопка «+»: от её низа до низа боковой колонки. */
export type PopoverAnchor = { fromBottom: number };

export type PopReactionPopoverProps = {
  reactions: PopReactions;
  /** Размер страницы. */
  width: number;
  height: number;
  anchor: PopoverAnchor;
  /** Низ колонки — от низа страницы. */
  columnBottom: number;
  onSelect: (emoji: string) => void;
  onClose: () => void;
};

/**
 * Выбор реакции по «+»: тот же блок, что над меню сообщения, — слева от
 * колонки, низом к низу кнопки, раскрытие растёт вверх. Видео под ним играет;
 * тап мимо закрывает.
 */
export function PopReactionPopover({
  reactions,
  width,
  height,
  anchor,
  columnBottom,
  onSelect,
  onClose,
}: PopReactionPopoverProps) {
  const [expanded, setExpanded] = useState(false);
  // Слева от колонки, вплотную.
  const right = Spacing.one + Sizes.popSideColumn + Spacing.one;
  const geometry = useMemo(
    () => pickerGeometry(width - right - Spacing.two, { options: popPickerOptions(reactions) }),
    [reactions, right, width],
  );
  const bottom = columnBottom + anchor.fromBottom;

  return (
    <>
      <Pressable
        testID="pop-reaction-backdrop"
        accessibilityLabel="Закрыть выбор реакции"
        onPress={onClose}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View
        entering={FadeIn.duration(FADE_MS)}
        exiting={FadeOut.duration(FADE_MS)}
        style={StyleSheet.absoluteFill}
        pointerEvents="box-none"
      >
        <ReactionPicker
          geometry={geometry}
          selected={reactions.mine}
          expanded={expanded}
          maxHeight={height - bottom - Sizes.popSideButton * 2}
          onToggleExpanded={() => setExpanded((value) => !value)}
          onSelect={onSelect}
          // Блок сам стоит абсолютно — место ему задаёт тот, кто показывает.
          style={{ right, bottom }}
        />
      </Animated.View>
    </>
  );
}
