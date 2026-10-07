import { SymbolView } from 'expo-symbols';
import { Pressable } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { commentsCountLabel } from '@/features/interactions/comments/commentsCount';
import { useTheme } from '@/hooks/use-theme';
import { Opacity, Sizes, Spacing, type ThemeColor } from '@/theme';

/**
 * На чём стоит кнопка: в своём облачке (на `primary`), в чужом, под альбомом
 * без облачка (на фоне чата) или поверх медиа.
 */
export type CommentsButtonTone = 'own' | 'other' | 'bare' | 'overlay';

const COLORS: Record<CommentsButtonTone, { background: ThemeColor; tint: ThemeColor }> = {
  own: { background: 'reactionChipOnPrimary', tint: 'primaryText' },
  other: { background: 'backgroundSelected', tint: 'textSecondary' },
  bare: { background: 'backgroundElement', tint: 'textSecondary' },
  overlay: { background: 'mediaScrim', tint: 'textOnMedia' },
};

export type CommentsButtonProps = {
  count: number;
  tone: CommentsButtonTone;
  /**
   * Тихая кнопка — у участника на сообщении без комментариев: написать
   * первым можно, но облачко остаётся главным. Меньше, без подложки и
   * полупрозрачная.
   */
  quiet?: boolean;
  /** Нет обработчика — кнопка только показывает число (копия облачка в меню). */
  onPress?: () => void;
};

/**
 * Кнопка комментариев в облачке: значок и число, при нуле — только значок.
 * Комментарии есть у каждого отправленного сообщения, поэтому и кнопка у
 * каждого: так видно, что комментировать можно всегда.
 */
export function CommentsButton({ count, tone, quiet = false, onPress }: CommentsButtonProps) {
  const theme = useTheme();
  const colors = COLORS[tone];

  return (
    <Pressable
      testID="comments-button"
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Комментарии: ${commentsCountLabel(count)}` : 'Комментарии'}
      disabled={!onPress}
      hitSlop={quiet ? Spacing.two : Spacing.one}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        quiet
          ? styles.quiet
          : { backgroundColor: theme[colors.background], opacity: pressed ? Opacity.pressed : 1 },
      ]}
    >
      <SymbolView
        name={{ ios: 'bubble.left', android: 'chat_bubble', web: 'chat_bubble' }}
        size={quiet ? Sizes.commentsIconQuiet : Sizes.commentsIcon}
        tintColor={theme[colors.tint]}
      />
      {count > 0 ? (
        <Text variant="caption" color={colors.tint}>
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}
