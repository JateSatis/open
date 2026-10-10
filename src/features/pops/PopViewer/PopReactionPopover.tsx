import { useMemo, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { styles } from './styles';

import type { PopReactions } from '@/api/pops';
import { pickerGeometry, ReactionPicker } from '@/features/interactions/ReactionPicker';
import { popPickerOptions } from '@/features/pops/popReactions';
import { Sizes, Spacing } from '@/theme';

const FADE_MS = 150;

/** Где кнопка «+» на странице — к ней прижимается поповер. */
export type PopoverAnchor = { x: number; y: number; height: number };

export type PopReactionPopoverProps = {
  reactions: PopReactions;
  /** Размер страницы. */
  width: number;
  height: number;
  anchor: PopoverAnchor;
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
  onSelect,
  onClose,
}: PopReactionPopoverProps) {
  const [expanded, setExpanded] = useState(false);
  const right = width - anchor.x + Spacing.one;
  const geometry = useMemo(
    () => pickerGeometry(width - right - Spacing.two, { options: popPickerOptions(reactions) }),
    [reactions, right, width],
  );
  const bottom = height - (anchor.y + anchor.height);

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
        style={[styles.popover, { right, bottom }]}
      >
        <ReactionPicker
          geometry={geometry}
          selected={reactions.mine}
          expanded={expanded}
          maxHeight={height - bottom - Sizes.popSideButton * 2}
          onToggleExpanded={() => setExpanded((value) => !value)}
          onSelect={onSelect}
        />
      </Animated.View>
    </>
  );
}
