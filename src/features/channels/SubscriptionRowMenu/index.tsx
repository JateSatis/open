import { useCallback } from 'react';
import { useWindowDimensions } from 'react-native';
import { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from './styles';

import type { ChatSummary } from '@/api/chats';
import { MenuList, menuListHeight, type MenuAction } from '@/components/MenuList';
import { MenuModal, useMenuTransition } from '@/components/MenuModal';
import type { RowRect } from '@/features/chats/ChatListItem';
import { useSubscriptionActions } from '@/features/channels/subscription';
import { useChatSubscriptionActions } from '@/features/chats/chatSubscription';
import { Spacing } from '@/theme';

type RowMenuItem = 'read' | 'mute' | 'unmute' | 'hide' | 'unsubscribe';

export type SubscriptionRowTarget = { chat: ChatSummary; rect: RowRect };

export type SubscriptionRowMenuProps = {
  /** Строка подписки (канал или чужой чат), на которой долго нажали; `null` — меню нет. */
  target: SubscriptionRowTarget | null;
  /** Закрытие доиграло — владелец снимает цель. */
  onClosed: () => void;
};

/**
 * У канала — ещё «Не отображать в чатах»; у чужого диалога и группы подписка
 * одного уровня: убрать из чатов и значит отписаться.
 */
function actionsFor(chat: ChatSummary): MenuAction<RowMenuItem>[] {
  return [
    { id: 'read', label: 'Прочитать все' },
    chat.subscription?.notify === false
      ? { id: 'unmute', label: 'Включить уведомления' }
      : { id: 'mute', label: 'Выключить уведомления' },
    ...(chat.channel ? [{ id: 'hide' as const, label: 'Не отображать в чатах' }] : []),
    { id: 'unsubscribe', label: 'Отписаться', destructive: true },
  ];
}

/**
 * Меню подписки по долгому нажатию в «Чатах»: под строкой, а если снизу не
 * помещается — над ней. Затемнение и анимации — как у остальных меню.
 */
export function SubscriptionRowMenu({ target, onClosed }: SubscriptionRowMenuProps) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { progress, close } = useMenuTransition(target, onClosed);
  const channelActions = useSubscriptionActions(target?.chat.channel?.id ?? '');
  const chatActions = useChatSubscriptionActions(target?.chat.id ?? '');
  const isChannel = Boolean(target?.chat.channel);

  const menuStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.9 + progress.value * 0.1 }],
  }));

  const run = useCallback(
    (item: RowMenuItem) => {
      switch (item) {
        case 'read':
          void (isChannel ? channelActions.readAll() : chatActions.readAll());
          return;
        case 'mute':
          void (isChannel ? channelActions.setNotify(false) : chatActions.setNotify(false));
          return;
        case 'unmute':
          void (isChannel ? channelActions.setNotify(true) : chatActions.setNotify(true));
          return;
        case 'hide':
          void channelActions.setInChats(false);
          return;
        case 'unsubscribe':
          void (isChannel ? channelActions.unsubscribe() : chatActions.unsubscribe());
          return;
      }
    },
    [channelActions, chatActions, isChannel],
  );

  const items = target ? actionsFor(target.chat) : [];
  const height = menuListHeight(items.length);
  const below = target ? target.rect.y + target.rect.height : 0;
  const fitsBelow = below + height + Spacing.two <= windowHeight - insets.bottom;
  const position = target
    ? {
        left: target.rect.x + Spacing.five,
        top: fitsBelow ? below : target.rect.y - height,
        transformOrigin: fitsBelow ? 'top left' : 'bottom left',
      }
    : null;

  return (
    <MenuModal
      visible={target !== null}
      progress={progress}
      onRequestClose={() => close(null)}
      onBackdropPress={() => close(null)}
      backdropTestID="subscription-menu-backdrop"
    >
      {position ? (
        <MenuList
          testID="subscription-menu"
          actions={items}
          onSelect={(id) => close(() => run(id))}
          style={[styles.menu, position, menuStyle]}
        />
      ) : null}
    </MenuModal>
  );
}
