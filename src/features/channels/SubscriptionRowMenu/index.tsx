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
import { Spacing } from '@/theme';

type RowMenuItem = 'read' | 'mute' | 'unmute' | 'hide' | 'unsubscribe';

export type SubscriptionRowTarget = { chat: ChatSummary; rect: RowRect };

export type SubscriptionRowMenuProps = {
  /** Строка канала-подписки, на которой долго нажали; `null` — меню нет. */
  target: SubscriptionRowTarget | null;
  /** Закрытие доиграло — владелец снимает цель. */
  onClosed: () => void;
};

function actionsFor(chat: ChatSummary): MenuAction<RowMenuItem>[] {
  return [
    { id: 'read', label: 'Прочитать все' },
    chat.subscription?.notify === false
      ? { id: 'unmute', label: 'Включить уведомления' }
      : { id: 'mute', label: 'Выключить уведомления' },
    { id: 'hide', label: 'Не отображать в чатах' },
    { id: 'unsubscribe', label: 'Отписаться', destructive: true },
  ];
}

/**
 * Меню канала-подписки по долгому нажатию в «Чатах»: под строкой, а если
 * снизу не помещается — над ней. Затемнение и анимации — как у остальных меню.
 */
export function SubscriptionRowMenu({ target, onClosed }: SubscriptionRowMenuProps) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { progress, close } = useMenuTransition(target, onClosed);
  const actions = useSubscriptionActions(target?.chat.channel?.id ?? '');

  const menuStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.9 + progress.value * 0.1 }],
  }));

  const run = useCallback(
    (item: RowMenuItem) => {
      switch (item) {
        case 'read':
          void actions.readAll();
          return;
        case 'mute':
          void actions.setNotify(false);
          return;
        case 'unmute':
          void actions.setNotify(true);
          return;
        case 'hide':
          void actions.setInChats(false);
          return;
        case 'unsubscribe':
          void actions.unsubscribe();
          return;
      }
    },
    [actions],
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
