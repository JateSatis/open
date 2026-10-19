import { useCallback, useRef, useState } from 'react';
import { useWindowDimensions, type View } from 'react-native';
import { useAnimatedStyle } from 'react-native-reanimated';

import { styles } from './styles';

import { FloatingButton } from '@/components/FloatingButton';
import { MenuList, menuListHeight, type MenuAction } from '@/components/MenuList';
import { MenuModal, useMenuTransition } from '@/components/MenuModal';
import { Spacing } from '@/theme';

export type CreateMenuItem = 'chat' | 'channel';

const ACTIONS: readonly MenuAction<CreateMenuItem>[] = [
  { id: 'chat', label: 'Чат' },
  { id: 'channel', label: 'Канал' },
];

type ButtonRect = { x: number; y: number; width: number; height: number };

export type CreateMenuProps = {
  /** Пункт выбран; зовётся, когда меню уже закрылось. */
  onSelect: (item: CreateMenuItem) => void;
  /** Высота панели вкладок под кнопкой. */
  bottomInset?: number;
};

/**
 * Кнопка «+» списка чатов и её меню. Меню стоит над кнопкой, правым краем
 * по её правому краю. Затемнение и анимации — как у меню сообщения.
 */
export function CreateMenu({ onSelect, bottomInset }: CreateMenuProps) {
  const buttonRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<ButtonRect | null>(null);
  const { width: windowWidth } = useWindowDimensions();
  const onClosed = useCallback(() => setAnchor(null), []);
  const { progress, close } = useMenuTransition(anchor, onClosed);

  const menuStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.9 + progress.value * 0.1 }],
  }));

  const open = () => {
    buttonRef.current?.measureInWindow((x, y, width, height) =>
      setAnchor({ x, y, width, height }),
    );
  };

  const position = anchor
    ? {
        right: windowWidth - (anchor.x + anchor.width),
        top: anchor.y - Spacing.two - menuListHeight(ACTIONS.length),
      }
    : null;

  return (
    <>
      <FloatingButton
        ref={buttonRef}
        testID="create-button"
        icon={{ ios: 'plus', android: 'add' }}
        accessibilityLabel="Создать"
        onPress={open}
        bottomInset={bottomInset}
      />

      <MenuModal
        visible={anchor !== null}
        progress={progress}
        onRequestClose={() => close(null)}
        onBackdropPress={() => close(null)}
        backdropTestID="create-menu-backdrop"
      >
        {position ? (
          <MenuList
            testID="create-menu"
            actions={ACTIONS}
            onSelect={(id) => close(() => onSelect(id))}
            style={[styles.menu, position, menuStyle]}
          />
        ) : null}
      </MenuModal>
    </>
  );
}
