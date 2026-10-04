import type { ReactNode } from 'react';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { styles } from './styles';

import { useTheme } from '@/hooks/use-theme';

export type SheetHeaderProps = {
  /** Ход шита: здесь шапка стоит в содержимом, пока шит не доехал доверху. */
  travel: number;
  scrollOffset: SharedValue<number>;
  onHeight: (height: number) => void;
  children: ReactNode;
};

/**
 * Шапка шита — заголовок и исходное сообщение — в содержимом списка, над
 * строками. Пока едет шит, она едет вместе с подложкой; доехав доверху,
 * прилипает к верху окна, и комментарии листаются под ней. Двигается только
 * сдвигом — раскладка от скролла не меняется ни в одном кадре.
 */
export function SheetHeader({ travel, scrollOffset, onHeight, children }: SheetHeaderProps) {
  const theme = useTheme();

  const stickStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(0, scrollOffset.value - travel) }],
  }));

  return (
    <Animated.View
      testID="comments-sheet-header"
      style={[styles.sheetHeader, { top: travel, backgroundColor: theme.background }, stickStyle]}
      onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
    >
      {children}
    </Animated.View>
  );
}
