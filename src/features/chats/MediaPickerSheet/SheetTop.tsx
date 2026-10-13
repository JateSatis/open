import { View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';

type SheetTopProps = {
  height: number;
  /** Заголовок под ручкой, слева; нет — только ручка. */
  title?: string;
};

/**
 * Верх шита: ручка и заголовок. Один и тот же в оболочке первого кадра и в
 * шапке списка — иначе сетка прыгнула бы, когда список сменяет скелет. Фон
 * под ним рисует подложка.
 */
export function SheetTop({ height, title }: SheetTopProps) {
  const theme = useTheme();

  return (
    <View style={[styles.sheetTop, { height }]}>
      <View style={[styles.handleBar, { backgroundColor: theme.border }]} />
      {title ? (
        // Высота полосы задана числом (с ней считается сетка), поэтому
        // крупный шрифт системы её не раздувает.
        <Text
          variant="subtitle"
          allowFontScaling={false}
          numberOfLines={1}
          style={styles.sheetTitle}
        >
          {title}
        </Text>
      ) : null}
    </View>
  );
}
