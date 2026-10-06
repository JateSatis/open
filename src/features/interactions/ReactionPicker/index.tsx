import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type AnimatedStyle,
} from 'react-native-reanimated';

import type { PickerGeometry } from './geometry';
import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export { pickerGeometry, type PickerGeometry } from './geometry';

const EXPAND_MS = 220;

export type ReactionPickerProps = {
  geometry: PickerGeometry;
  /** Моя реакция — подсвечена; тап по ней снимает. */
  selected: string | null;
  expanded: boolean;
  /** Раскрытый блок не растёт ниже края экрана — дальше он прокручивается. */
  maxHeight: number;
  onToggleExpanded: () => void;
  onSelect: (emoji: string) => void;
  /** Где стоит и как появляется — решает меню. */
  style?: StyleProp<AnimatedStyle<ViewStyle>>;
};

/**
 * Реакции над меню сообщения. Свёрнутый — полоса основных, справа кнопка
 * раскрытия; раскрытый — та же полоса и под ней сетка всего набора. Полоса —
 * первая строка сетки, поэтому раскрытие — это только рост высоты: ничего не
 * перестраивается и не мигает.
 */
export function ReactionPicker({
  geometry,
  selected,
  expanded,
  maxHeight,
  onToggleExpanded,
  onSelect,
  style,
}: ReactionPickerProps) {
  const theme = useTheme();
  const target = expanded
    ? Math.max(geometry.collapsedHeight, Math.min(geometry.expandedHeight, maxHeight))
    : geometry.collapsedHeight;
  const height = useSharedValue(target);
  const turn = useSharedValue(expanded ? 1 : 0);

  useEffect(() => {
    height.set(withTiming(target, { duration: EXPAND_MS }));
    turn.set(withTiming(expanded ? 1 : 0, { duration: EXPAND_MS }));
  }, [expanded, height, target, turn]);

  // Сетка всего набора появляется с первым раскрытием и дальше остаётся:
  // обычное открытие меню не платит за сотню эмодзи, которых не видно.
  const [revealed, setRevealed] = useState(expanded);

  if (expanded && !revealed) setRevealed(true);

  const heightStyle = useAnimatedStyle(() => ({ height: height.value }));
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.value * 180}deg` }],
  }));

  const cell = (emoji: string) => (
    <Pressable
      key={emoji}
      testID={`reaction-option-${emoji}`}
      accessibilityRole="button"
      accessibilityLabel={selected === emoji ? `Снять реакцию ${emoji}` : `Реакция ${emoji}`}
      accessibilityState={{ selected: selected === emoji }}
      onPress={() => onSelect(emoji)}
      style={({ pressed }) => [
        styles.cell,
        selected === emoji && { backgroundColor: theme.messageHighlight },
        pressed && { backgroundColor: theme.backgroundSelected },
      ]}
    >
      <Text variant="emoji">{emoji}</Text>
    </Pressable>
  );

  return (
    <Animated.View
      testID="reaction-picker"
      style={[
        styles.picker,
        { width: geometry.width, backgroundColor: theme.backgroundElement },
        heightStyle,
        style,
      ]}
    >
      <ScrollView scrollEnabled={expanded} showsVerticalScrollIndicator={expanded} bounces={false}>
        <View style={styles.grid}>
          {geometry.firstRow.map(cell)}
          <Pressable
            testID="reaction-picker-expand"
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Свернуть реакции' : 'Все реакции'}
            accessibilityState={{ expanded }}
            onPress={onToggleExpanded}
            style={styles.cell}
          >
            <Animated.View style={chevronStyle}>
              <SymbolView
                name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }}
                size={Spacing.four}
                tintColor={theme.textSecondary}
              />
            </Animated.View>
          </Pressable>

          {revealed ? geometry.rest.map(cell) : null}
        </View>
      </ScrollView>
    </Animated.View>
  );
}
