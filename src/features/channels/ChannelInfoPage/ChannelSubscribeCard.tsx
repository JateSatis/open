import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { InfoPageSizes, Opacity, Radii, Spacing } from '@/theme';

export type ChannelSubscribeCardProps = {
  /** Уже подписан (только что): вместо «Подписаться» — «Вы подписаны» и «Добавить в чаты». */
  subscribed: boolean;
  onSubscribe: () => void;
  onAddToChats: () => void;
};

/**
 * Главное действие постороннего на странице канала: подписаться. Подписка —
 * без «Чатов»; следующим шагом карточка предлагает добавить канал в чаты, и
 * после этого исчезает.
 */
export function ChannelSubscribeCard({
  subscribed,
  onSubscribe,
  onAddToChats,
}: ChannelSubscribeCardProps) {
  const theme = useTheme();

  if (!subscribed) {
    return (
      <Pressable
        testID="info-subscribe"
        accessibilityRole="button"
        onPress={onSubscribe}
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: theme.primary },
          pressed && styles.pressed,
        ]}
      >
        <SymbolView
          name={{ ios: 'plus', android: 'add', web: 'add' }}
          size={InfoPageSizes.actionIcon}
          tintColor={theme.primaryText}
        />
        <Text variant="bodyBold" color="primaryText">
          Подписаться
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.pair}>
      <View
        testID="info-subscribed"
        accessibilityRole="text"
        style={[styles.card, styles.half, { backgroundColor: theme.backgroundElement }]}
      >
        <SymbolView
          name={{ ios: 'checkmark', android: 'check', web: 'check' }}
          size={InfoPageSizes.actionIcon}
          tintColor={theme.textSecondary}
        />
        <Text variant="bodyBold" color="textSecondary" numberOfLines={1}>
          Вы подписаны
        </Text>
      </View>
      <Pressable
        testID="info-add-to-chats"
        accessibilityRole="button"
        onPress={onAddToChats}
        style={({ pressed }) => [
          styles.card,
          styles.half,
          { backgroundColor: theme.primary },
          pressed && styles.pressed,
        ]}
      >
        <SymbolView
          name={{ ios: 'bubble.left.and.bubble.right', android: 'forum', web: 'forum' }}
          size={InfoPageSizes.actionIcon}
          tintColor={theme.primaryText}
        />
        <Text variant="bodyBold" color="primaryText" numberOfLines={1}>
          Добавить в чаты
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.three,
    minHeight: InfoPageSizes.cardRowMinHeight,
    borderRadius: Radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  pair: {
    flexDirection: 'row',
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.three,
    gap: Spacing.two,
  },
  half: {
    flex: 1,
    marginHorizontal: 0,
    marginBottom: 0,
    paddingHorizontal: Spacing.two,
  },
  pressed: {
    opacity: Opacity.pressed,
  },
});
