import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';

export {
  MENU_CLOSE_MS,
  MENU_OPEN_MS,
  useMenuTransition,
  type MenuTransition,
} from './useMenuTransition';

export type MenuModalProps = {
  visible: boolean;
  /** Прогресс открытия из `useMenuTransition`: затемнение проявляется вместе с ним. */
  progress: SharedValue<number>;
  /** Системное «назад». */
  onRequestClose: () => void;
  /** Тап по затемнению мимо меню. */
  onBackdropPress: () => void;
  backdropTestID?: string;
  /** Меню и всё, что лежит над затемнением. */
  children: ReactNode;
};

/**
 * Окно всплывающего меню с затемнением. Своё окно (`Modal`) — единственный
 * способ затемнить и нативный заголовок, и нативный таб-бар (см. заметку про
 * шит медиа).
 */
export function MenuModal({
  visible,
  progress,
  onRequestClose,
  onBackdropPress,
  backdropTestID,
  children,
}: MenuModalProps) {
  const theme = useTheme();
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={onRequestClose}
    >
      {visible ? (
        <View style={StyleSheet.absoluteFill}>
          <Animated.View
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }, backdropStyle]}
          >
            <Pressable
              testID={backdropTestID}
              accessibilityLabel="Закрыть меню"
              style={StyleSheet.absoluteFill}
              onPress={onBackdropPress}
            />
          </Animated.View>

          {children}
        </View>
      ) : null}
    </Modal>
  );
}
