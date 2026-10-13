import { useCallback } from 'react';
import { useWindowDimensions } from 'react-native';
import { useAnimatedStyle } from 'react-native-reanimated';

import { styles } from './styles';

import { MenuList, menuListHeight, type MenuAction } from '@/components/MenuList';
import { MenuModal, useMenuTransition } from '@/components/MenuModal';
import { Sizes, Spacing } from '@/theme';

/** Прямоугольник элемента в координатах окна — от `measureInWindow`. */
export type MenuAnchor = { x: number; y: number; width: number; height: number };

export type AnchoredMenuProps<Id extends string> = {
  /** У чего открыто меню; null — закрыто. */
  anchor: MenuAnchor | null;
  actions: MenuAction<Id>[];
  /** Пункт выбран — вызывается, когда меню доиграло закрытие. */
  onSelect: (id: Id) => void;
  /** Меню закрылось — выбором или тапом мимо. */
  onClosed: () => void;
  testID: string;
};

/**
 * Меню у элемента по долгому нажатию: под ним, если помещается, иначе над
 * ним; по горизонтали — от его середины, не вылезая за края. Затемнение и
 * анимации — как у остальных меню.
 */
export function AnchoredMenu<Id extends string>({
  anchor,
  actions,
  onSelect,
  onClosed,
  testID,
}: AnchoredMenuProps<Id>) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { progress, close } = useMenuTransition(anchor, onClosed);
  const finishClosed = useCallback(() => close(null), [close]);

  const menuStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.9 + progress.value * 0.1 }],
  }));

  let position: { left: number; top: number } | null = null;

  if (anchor) {
    const height = menuListHeight(actions.length);
    const below = anchor.y + anchor.height + Spacing.one;
    const top =
      below + height < windowHeight - Spacing.four ? below : anchor.y - height - Spacing.one;
    const center = anchor.x + anchor.width / 2 - Sizes.menuMinWidth / 2;

    position = {
      left: Math.min(Math.max(Spacing.two, center), windowWidth - Sizes.menuMinWidth - Spacing.two),
      top: Math.max(Spacing.four, top),
    };
  }

  return (
    <MenuModal
      visible={anchor !== null}
      progress={progress}
      onRequestClose={finishClosed}
      onBackdropPress={finishClosed}
      backdropTestID={`${testID}-backdrop`}
    >
      {position ? (
        <MenuList
          testID={testID}
          actions={actions}
          onSelect={(id) => close(() => onSelect(id))}
          style={[styles.menu, position, menuStyle]}
        />
      ) : null}
    </MenuModal>
  );
}
