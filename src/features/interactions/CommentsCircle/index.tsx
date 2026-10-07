import { SymbolView } from 'expo-symbols';
import { Pressable } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { formatViewsCount } from '@/features/chats/ViewsCount/formatViewsCount';
import { commentsCountLabel } from '@/features/interactions/comments/commentsCount';
import { useTheme } from '@/hooks/use-theme';
import { Opacity, Sizes } from '@/theme';

export type CommentsCircleProps = {
  count: number;
  /** Нет обработчика — круг только показывает число (копия облачка). */
  onPress?: () => void;
};

/**
 * Круг комментариев сбоку от облачка: сверху значок, под ним крупно число,
 * при нуле — только значок.
 */
export function CommentsCircle({ count, onPress }: CommentsCircleProps) {
  const theme = useTheme();

  return (
    <Pressable
      testID="comments-circle"
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Комментарии: ${commentsCountLabel(count)}` : 'Комментарии'}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.circle,
        { backgroundColor: theme.backgroundElement, opacity: pressed ? Opacity.pressed : 1 },
      ]}
    >
      <SymbolView
        name={{ ios: 'bubble.left', android: 'chat_bubble', web: 'chat_bubble' }}
        size={Sizes.commentsCircleIcon}
        tintColor={theme.textSecondary}
      />
      {count > 0 ? (
        <Text variant="smallBold" color="text" style={styles.count} numberOfLines={1}>
          {formatViewsCount(count)}
        </Text>
      ) : null}
    </Pressable>
  );
}
