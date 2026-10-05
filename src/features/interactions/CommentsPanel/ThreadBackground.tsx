import { View } from 'react-native';

import { styles } from './styles';

import { useTheme } from '@/hooks/use-theme';

export type ThreadBackgroundProps = {
  /** Корень треда: скруглённый верх. */
  first: boolean;
  /** Последняя строка треда: скруглённый низ. */
  last: boolean;
};

/**
 * Фон раскрытого треда на высоту одной строки. Тред разложен на строки, и
 * каждая рисует свой кусок; состыкованные, они дают сплошную подложку со
 * скруглёнными углами у корня и у последнего ответа — как островок
 * пересылки, только без пунктира.
 */
export function ThreadBackground({ first, last }: ThreadBackgroundProps) {
  const theme = useTheme();

  return (
    <View
      testID="thread-background"
      pointerEvents="none"
      style={[
        styles.threadBackground,
        { backgroundColor: theme.islandBackground },
        first && styles.threadBackgroundFirst,
        last && styles.threadBackgroundLast,
      ]}
    />
  );
}
