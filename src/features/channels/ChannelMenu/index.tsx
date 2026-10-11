import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, useWindowDimensions, type View } from 'react-native';
import { useAnimatedStyle } from 'react-native-reanimated';

import { styles } from './styles';
import { channelMenuActions, type ChannelMenuItem } from './actions';

import { MenuList } from '@/components/MenuList';
import { MenuModal, useMenuTransition } from '@/components/MenuModal';
import { useSubscriptionActions } from '@/features/channels/subscription';
import { useChannelSubscription } from '@/features/channels/useChannelSubscription';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing } from '@/theme';

type ButtonRect = { x: number; y: number; width: number; height: number };

export type ChannelMenuProps = {
  channelId: string;
  /** Я создатель канала: мне — список подписчиков. */
  isOwner: boolean;
};

/**
 * «⋮» справа в шапке канала и меню под ним поверх страницы. Подписчику —
 * уведомления, чаты и отписка, создателю — «Подписчики». Постороннему и
 * пока роль не известна — кнопки нет.
 */
export function ChannelMenu({ channelId, isOwner }: ChannelMenuProps) {
  const theme = useTheme();
  const router = useRouter();
  const buttonRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<ButtonRect | null>(null);
  const { width: windowWidth } = useWindowDimensions();
  const { status, subscription } = useChannelSubscription(channelId);
  const actions = useSubscriptionActions(channelId);
  const onClosed = useCallback(() => setAnchor(null), []);
  const { progress, close } = useMenuTransition(anchor, onClosed);

  const menuStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.9 + progress.value * 0.1 }],
  }));

  const items = channelMenuActions(status, subscription, isOwner);

  if (items.length === 0) return null;

  const open = () => {
    buttonRef.current?.measureInWindow((x, y, width, height) =>
      setAnchor({ x, y, width, height }),
    );
  };

  const run = (item: ChannelMenuItem) => {
    switch (item) {
      case 'subscribers':
        router.push({ pathname: '/chats/channel-subscribers/[channelId]', params: { channelId } });
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
      case 'add':
        void actions.setInChats(true);
        return;
      case 'unsubscribe':
        void actions.unsubscribe();
        return;
    }
  };

  const position = anchor
    ? {
        right: windowWidth - (anchor.x + anchor.width),
        top: anchor.y + anchor.height + Spacing.one,
      }
    : null;

  return (
    <>
      <Pressable
        ref={buttonRef}
        testID="channel-menu-button"
        accessibilityRole="button"
        accessibilityLabel="Меню канала"
        hitSlop={Spacing.three}
        onPress={open}
      >
        <SymbolView
          name={{ ios: 'ellipsis', android: 'more_vert', web: 'more_vert' }}
          size={Sizes.callIcon + Spacing.one}
          tintColor={theme.primary}
        />
      </Pressable>

      <MenuModal
        visible={anchor !== null}
        progress={progress}
        onRequestClose={() => close(null)}
        onBackdropPress={() => close(null)}
        backdropTestID="channel-menu-backdrop"
      >
        {position ? (
          <MenuList
            testID="channel-menu"
            actions={items}
            onSelect={(id) => close(() => run(id))}
            style={[styles.menu, position, menuStyle]}
          />
        ) : null}
      </MenuModal>
    </>
  );
}
