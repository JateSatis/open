import { SymbolView } from 'expo-symbols';
import { View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { formatViewsCount } from './formatViewsCount';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, type ThemeColor } from '@/theme';

/** На чём стоит счётчик: своё облачко (`primary`), чужое или плашка на медиа. */
export type ViewsCountTone = 'own' | 'other' | 'overlay';

const TINT: Record<ViewsCountTone, ThemeColor> = {
  own: 'metaOnPrimary',
  other: 'textSecondary',
  overlay: 'textOnMedia',
};

export type ViewsCountProps = { count: number; tone: ViewsCountTone };

/** Сколько раз сообщение показывалось на экранах: значок глаза и короткое число. */
export function ViewsCount({ count, tone }: ViewsCountProps) {
  const theme = useTheme();
  const tint = TINT[tone];

  return (
    <View
      testID="message-views"
      accessible
      accessibilityLabel={`Просмотры: ${count}`}
      style={[
        styles.views,
        tone === 'overlay' && [styles.overlay, { backgroundColor: theme.mediaScrim }],
      ]}
    >
      <SymbolView
        name={{ ios: 'eye', android: 'visibility', web: 'visibility' }}
        size={Sizes.viewsIcon}
        tintColor={theme[tint]}
      />
      <Text variant="meta" color={tint}>
        {formatViewsCount(count)}
      </Text>
    </View>
  );
}
