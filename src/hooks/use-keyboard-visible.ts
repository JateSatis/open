import { useEffect, useState } from 'react';
import { Keyboard, Platform, type KeyboardEventName } from 'react-native';

/**
 * Видна ли экранная клавиатура. Нужно, чтобы не складывать её высоту с
 * отступом под системную навигацию: клавиатура перекрывает эту полосу, и
 * второй отступ поднял бы поле ввода выше, чем надо.
 */
export function useKeyboardVisible(): boolean {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // iOS сообщает о клавиатуре до анимации, Android — только после;
    // разные события дают одинаково своевременную реакцию на обеих.
    const showEvent = Platform.select<KeyboardEventName>({
      ios: 'keyboardWillShow',
      default: 'keyboardDidShow',
    });
    const hideEvent = Platform.select<KeyboardEventName>({
      ios: 'keyboardWillHide',
      default: 'keyboardDidHide',
    });

    const shown = Keyboard.addListener(showEvent, () => setIsVisible(true));
    const hidden = Keyboard.addListener(hideEvent, () => setIsVisible(false));

    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return isVisible;
}
