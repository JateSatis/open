import { View } from 'react-native';

import { styles } from './styles';

import { Button } from '@/components/Button';
import { useChatSubscriptionActions } from '@/features/chats/chatSubscription';
import { useTheme } from '@/hooks/use-theme';

export type ChatSubscribeBarProps = { chatId: string };

/**
 * Низ чужого диалога или группы у постороннего без подписки: «Подписаться».
 * Подписка одного уровня — переписка сразу в «Чатах», вопроса «добавить в
 * чаты?» нет. Повторный тап, пока подписка уходит, ничего не делает: кнопка
 * исчезает сразу, вместе с оптимистичной подпиской.
 */
export function ChatSubscribeBar({ chatId }: ChatSubscribeBarProps) {
  const theme = useTheme();
  const { subscribe } = useChatSubscriptionActions(chatId);

  return (
    <View
      testID="chat-subscribe-bar"
      style={[styles.container, { borderTopColor: theme.border, backgroundColor: theme.background }]}
    >
      <Button testID="chat-subscribe-button" label="Подписаться" onPress={() => void subscribe()} />
    </View>
  );
}
