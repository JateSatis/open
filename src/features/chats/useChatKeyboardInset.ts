import { useCallback, useRef, useState } from 'react';
import type { View } from 'react-native';
import { useWindowDimensions as useKeyboardWindow } from 'react-native-keyboard-controller';
import { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOwnKeyboardHeight } from '@/features/chats/composerKeyboard';

/**
 * Отступ снизу у экрана переписки: поле ввода над клавиатурой.
 *
 * Клавиатуру приходится обходить вручную на обеих платформах: iOS рисует её
 * поверх экрана, а на Android с edge-to-edge окно под неё не сжимается.
 * Высота клавиатуры меряется от низа окна и уже покрывает и таб-бар, и
 * полосу системной навигации — поэтому отступ не сумма, а большее из двух.
 * Считается только от клавиатуры поля под чатом: поле в шите медиа двигает
 * себя, а не чат под шитом (см. `composerKeyboard`).
 */
export function useChatKeyboardInset() {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useOwnKeyboardHeight('chat');
  // Размер окна целиком, от края до края, — от него же меряется клавиатура.
  const { height: windowHeight } = useKeyboardWindow();
  const containerRef = useRef<View | null>(null);
  const [bottomOffset, setBottomOffset] = useState(0);
  const [top, setTop] = useState(0);

  /**
   * Что лежит под экраном чата до низа окна — таб-бар. Его клавиатура
   * перекрывает, и на его высоту поле подниматься не должно. Измеряется, а не
   * подбирается: таб-бар разный на разных устройствах и платформах.
   */
  const onLayout = useCallback(() => {
    containerRef.current?.measureInWindow((_x, y, _width, height) => {
      setBottomOffset(Math.max(0, windowHeight - (y + height)));
      setTop(y);
    });
  }, [windowHeight]);

  const style = useAnimatedStyle(() => ({
    paddingBottom: Math.max(keyboardHeight.value - bottomOffset, insets.bottom),
  }));

  /** `top` — верх экрана чата в окне, то есть низ его шапки: под ней встаёт панель комментариев. */
  return { containerRef, onLayout, style, top };
}
