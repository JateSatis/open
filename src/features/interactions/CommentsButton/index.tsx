import { SymbolView } from 'expo-symbols';
import { Pressable } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { commentsCountLabel } from '@/features/interactions/comments/commentsCount';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing } from '@/theme';

export type CommentsButtonProps = {
  count: number;
  /** Нет обработчика — кружок только показывает число (копия облачка в меню). */
  onPress?: () => void;
};

/**
 * Кружок комментариев у облачка: значок и число, при нуле — только значок.
 * Комментарии есть у каждого отправленного сообщения, поэтому и кружок у
 * каждого: так видно, что комментировать можно всегда.
 */
export function CommentsButton({ count, onPress }: CommentsButtonProps) {
  const theme = useTheme();

  return (
    <Pressable
      testID="comments-button"
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Комментарии: ${commentsCountLabel(count)}` : 'Комментарии'}
      disabled={!onPress}
      hitSlop={Spacing.one}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}
    >
      <SymbolView
        name={{ ios: 'bubble.left', android: 'chat_bubble', web: 'chat_bubble' }}
        size={Sizes.commentsIcon}
        tintColor={theme.textSecondary}
      />
      {count > 0 ? (
        <Text variant="caption" color="textSecondary">
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}
