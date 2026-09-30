import { View } from 'react-native';

import { styles } from './styles';

import { useTheme } from '@/hooks/use-theme';

export type IslandBorderProps = {
  /** Верх островка: скруглённые верхние углы. */
  top: boolean;
  /** Низ островка: скруглённые нижние углы. */
  bottom: boolean;
};

/**
 * Кусок пунктирной рамки островка с заливкой на высоту одной строки списка. Островок
 * разложен на строки (плашка и облачка), и каждая рисует свою часть: одна и
 * та же скруглённая рамка, выходящая за край строки там, где островок
 * продолжается, и обрезанная по строке. Состыкованные строки дают сплошной
 * контур со скруглёнными углами сверху и снизу — обычными `View`, без
 * отдельной отрисовки углов и без нативного пакета ради пунктира.
 */
export function IslandBorder({ top, bottom }: IslandBorderProps) {
  const theme = useTheme();

  return (
    <View testID="island-border" pointerEvents="none" style={styles.clip}>
      <View
        style={[
          styles.border,
          { borderColor: theme.islandBorder, backgroundColor: theme.islandBackground },
          top ? styles.top : styles.openTop,
          bottom ? styles.bottom : styles.openBottom,
        ]}
      />
    </View>
  );
}
