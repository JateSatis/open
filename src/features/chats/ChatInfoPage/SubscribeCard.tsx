import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet } from 'react-native';

import type { Subscription } from '@/api/subscriptions';
import { confirm } from '@/components/ConfirmDialog/store';
import { Text } from '@/components/Text';
import { useChatSubscriptionActions } from '@/features/chats/chatSubscription';
import { useTheme } from '@/hooks/use-theme';
import { InfoPageSizes, Opacity, Radii, Spacing } from '@/theme';

export type SubscribeCardProps = {
  chatId: string;
  isGroup: boolean;
  /** Моя подписка; `undefined` — ещё не известна, карточки нет. */
  subscription: Subscription | null | undefined;
};

/**
 * Главное действие постороннего: подписаться на чужой диалог или группу.
 * Срабатывает сразу, откатывается с понятной фразой, если база отказала.
 * Отписка — после вопроса.
 */
export function SubscribeCard({ chatId, isGroup, subscription }: SubscribeCardProps) {
  const theme = useTheme();
  const actions = useChatSubscriptionActions(chatId);

  if (subscription === undefined) return null;

  const subscribed = subscription !== null;

  const press = async () => {
    if (!subscribed) {
      await actions.subscribe();
      return;
    }

    const confirmed = await confirm({
      title: isGroup ? 'Отписаться от группы?' : 'Отписаться от диалога?',
      message: 'Чат уйдёт из «Чатов».',
      confirmLabel: 'Отписаться',
      cancelLabel: 'Отмена',
      destructive: true,
    });

    if (confirmed) await actions.unsubscribe();
  };

  return (
    <Pressable
      testID="info-subscribe"
      accessibilityRole="button"
      accessibilityState={{ selected: subscribed }}
      onPress={() => void press()}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: subscribed ? theme.backgroundElement : theme.primary },
        pressed && styles.pressed,
      ]}
    >
      <SymbolView
        name={
          subscribed
            ? { ios: 'checkmark', android: 'check', web: 'check' }
            : { ios: 'plus', android: 'add', web: 'add' }
        }
        size={InfoPageSizes.actionIcon}
        tintColor={subscribed ? theme.textSecondary : theme.primaryText}
      />
      <Text variant="bodyBold" color={subscribed ? 'textSecondary' : 'primaryText'}>
        {subscribed ? 'Вы подписаны' : isGroup ? 'Подписаться на группу' : 'Подписаться на диалог'}
      </Text>
    </Pressable>
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
  pressed: {
    opacity: Opacity.pressed,
  },
});
