import { SymbolView } from 'expo-symbols';
import { useCallback, useRef, useState } from 'react';
import { Pressable, useWindowDimensions, type View } from 'react-native';
import { useAnimatedStyle } from 'react-native-reanimated';

import { styles } from './styles';

import { MenuList, type MenuAction } from '@/components/MenuList';
import { MenuModal, useMenuTransition } from '@/components/MenuModal';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing } from '@/theme';

type ButtonRect = { x: number; y: number; width: number; height: number };

export type HeaderMenuProps<Id extends string> = {
  actions: MenuAction<Id>[];
  /** Пункт выбран — вызывается, когда меню доиграло закрытие. */
  onSelect: (id: Id) => void;
  accessibilityLabel: string;
  /** Префикс testID: `<prefix>-button`, `<prefix>`, `<prefix>-backdrop`. */
  testID: string;
};

/**
 * «⋮» справа в шапке и меню под ним поверх страницы: вырастает из-под кнопки,
 * затемнение и анимации — как у остальных меню. Пунктов нет — кнопки нет.
 */
export function HeaderMenu<Id extends string>({
  actions,
  onSelect,
  accessibilityLabel,
  testID,
}: HeaderMenuProps<Id>) {
  const theme = useTheme();
  const buttonRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<ButtonRect | null>(null);
  const { width: windowWidth } = useWindowDimensions();
  const onClosed = useCallback(() => setAnchor(null), []);
  const { progress, close } = useMenuTransition(anchor, onClosed);

  const menuStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.9 + progress.value * 0.1 }],
  }));

  if (actions.length === 0) return null;

  const open = () => {
    buttonRef.current?.measureInWindow((x, y, width, height) =>
      setAnchor({ x, y, width, height }),
    );
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
        testID={`${testID}-button`}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
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
    </>
  );
}
