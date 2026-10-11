import { View } from 'react-native';

import { styles } from './styles';

import { Button } from '@/components/Button';
import { confirm } from '@/components/ConfirmDialog';
import { useSubscriptionActions } from '@/features/channels/subscription';
import { useChannelSubscription } from '@/features/channels/useChannelSubscription';
import type { ChannelSection } from '@/features/channels/useMarkChannelSectionRead';
import { useTheme } from '@/hooks/use-theme';

export type SubscribeBarProps = {
  channelId: string;
  /** Открытый раздел: с «Постов» подписка сразу кладёт канал в «Чаты», с «Попсов» — спрашивает. */
  section: ChannelSection;
};

/**
 * Низ канала у того, кто в нём не публикует: «Подписаться», а подписчику без
 * чатов — «Добавить в чаты». Читателю и публикующему — ничего: у публикующего
 * здесь своё поле ввода, а читателю добавить уже нечего.
 */
export function SubscribeBar({ channelId, section }: SubscribeBarProps) {
  const theme = useTheme();
  const { status } = useChannelSubscription(channelId);
  const { subscribe, setInChats } = useSubscriptionActions(channelId);

  if (status !== 'none' && status !== 'subscriber') return null;

  const onPress = async () => {
    if (status === 'subscriber') {
      void setInChats(true);
      return;
    }

    if (section === 'posts') {
      void subscribe(true);
      return;
    }

    // Подписка уходит сразу, вопрос — поверх неё: закрыть его без ответа
    // («назад», тап мимо) — то же «Нет», подписка уже состоялась.
    const subscribed = subscribe(false);
    const add = await confirm({
      title: 'Хотите добавить в чаты?',
      message: 'Канал будет в «Чатах», новые посты и попсы — непрочитанными.',
      confirmLabel: 'Добавить',
      cancelLabel: 'Нет',
    });

    if (add && (await subscribed)) void setInChats(true);
  };

  return (
    <View
      testID="channel-subscribe-bar"
      style={[styles.container, { borderTopColor: theme.border, backgroundColor: theme.background }]}
    >
      <Button
        testID="channel-subscribe-button"
        label={status === 'subscriber' ? 'Добавить в чаты' : 'Подписаться'}
        onPress={() => void onPress()}
      />
    </View>
  );
}
