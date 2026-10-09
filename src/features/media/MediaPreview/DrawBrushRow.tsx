import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { DrawColorCircle } from './DrawColorCircle';
import { styles } from './styles';

import type { DrawBrush } from '@/features/media/photoEdits/drawing';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type DrawBrushRowProps = {
  brush: DrawBrush;
  /** Цвет выбранной кисти; нет — у неё цвета нет. */
  color: string | null;
  onBrush: (brush: DrawBrush) => void;
};

const BRUSHES: { key: DrawBrush; label: string; icon: SymbolViewProps['name'] }[] = [
  { key: 'pen', label: 'Перо', icon: { ios: 'pencil.tip', android: 'edit', web: 'edit' } },
  {
    key: 'arrow',
    label: 'Стрелка',
    icon: { ios: 'arrow.up.right', android: 'north_east', web: 'north_east' },
  },
  {
    key: 'marker',
    label: 'Маркер',
    icon: { ios: 'highlighter', android: 'ink_highlighter', web: 'ink_highlighter' },
  },
  {
    key: 'blur',
    label: 'Размытие',
    icon: { ios: 'drop.halffull', android: 'blur_on', web: 'blur_on' },
  },
  {
    key: 'eraser',
    label: 'Ластик',
    icon: { ios: 'eraser', android: 'ink_eraser', web: 'ink_eraser' },
  },
];

/** Кисти слева направо и кружок цвета; выбранная кисть — на подложке-кружке. */
export function DrawBrushRow({ brush, color, onBrush }: DrawBrushRowProps) {
  const theme = useTheme();

  return (
    <View style={styles.brushRow}>
      {BRUSHES.map((item) => {
        const selected = item.key === brush;

        return (
          <Pressable
            key={item.key}
            testID={`draw-brush-${item.key}`}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ selected }}
            hitSlop={Spacing.one}
            onPress={() => onBrush(item.key)}
            style={[styles.tool, styles.brush, selected && { backgroundColor: theme.mediaControl }]}
          >
            <SymbolView name={item.icon} size={Spacing.four} tintColor={theme.textOnMedia} />
          </Pressable>
        );
      })}

      <DrawColorCircle color={color} />
    </View>
  );
}
