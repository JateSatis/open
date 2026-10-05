import type { ReactNode } from 'react';
import { GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { styles } from './styles';

import { useTheme } from '@/hooks/use-theme';

export type SheetHeaderProps = {
  /** Ход шита: здесь шапка стоит в содержимом, пока шит не доехал доверху. */
  travel: number;
  scrollOffset: SharedValue<number>;
  onHeight: (height: number) => void;
  /** Жест шапки — ведёт тот же скролл, что и список (`usePanelSheet`). */
  pan: GestureType;
  children: ReactNode;
};

/**
 * Шапка шита — заголовок и исходное сообщение — слоем над окном списка, а
 * не в его содержимом. Пока едет шит, она едет вместе с подложкой; в верхнем
 * положении стоит у верха окна, и комментарии листаются под ней. Двигается
 * только сдвигом — раскладка от скролла не меняется ни в одном кадре.
 *
 * Не в содержимом — потому что событие скролла приходит на кадр позже самого
 * скролла: прилипшая в содержимом шапка дёргалась бы на кадр при каждом
 * программном скролле (скрытие треда, поправка позиции у `FlashList`). Здесь
 * в верхнем положении она от скролла не зависит вовсе. Касание по ней до
 * списка не доходит, поэтому у неё свой жест — он ведёт тот же скролл.
 */
export function SheetHeader({ travel, scrollOffset, onHeight, pan, children }: SheetHeaderProps) {
  const theme = useTheme();

  const followStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(0, travel - scrollOffset.value) }],
  }));

  return (
    <GestureDetector gesture={pan}>
    <Animated.View
      testID="comments-sheet-header"
      style={[styles.sheetHeader, { top: 0, backgroundColor: theme.background }, followStyle]}
      onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
    >
      {children}
    </Animated.View>
    </GestureDetector>
  );
}
