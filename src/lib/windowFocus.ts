import type { RefObject } from 'react';
import { AppState, Platform, type TextInput } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';

/**
 * Окно приложения в фокусе: поверх него нет окна `Modal` (меню сообщения,
 * шит, диалог). Следит только Android — там `Modal` живёт в отдельном окне.
 */
let windowFocused = true;
let pending: (() => void) | null = null;

if (Platform.OS === 'android') {
  AppState.addEventListener('blur', () => {
    windowFocused = false;
  });
  AppState.addEventListener('focus', () => {
    windowFocused = true;

    const run = pending;

    pending = null;
    run?.();
  });
}

/**
 * Выполнить `run`, когда окно приложения снова в фокусе, — обычно следующим
 * кадром, а если поверх ещё закрывается окно `Modal`, то сразу после него.
 * Ждёт только последний запрос: новый заменяет прежний.
 */
function whenWindowFocused(run: () => void, ownWindow: boolean) {
  requestAnimationFrame(() => {
    if (windowFocused || ownWindow) {
      pending = null;
      run();
      return;
    }

    pending = run;
  });
}

/**
 * Фокус в поле — и клавиатура на экране. Две ловушки, из-за которых после
 * «Ответить» поле бывало в фокусе, а клавиатуры не было:
 *
 * - `focus()` ничего не делает, если поле уже в фокусе: RN сверяет его с
 *   текущим и не зовёт нативную сторону. А поле остаётся в фокусе, когда
 *   клавиатуру спрятали «назад» или жестом, — и свайп ответа её не поднимал.
 *   Тогда клавиатуру просит `setFocusTo('current')`: он заново фокусирует
 *   последнее поле нативно, и Android показывает клавиатуру;
 * - Android молча не показывает клавиатуру полю в окне без фокуса, а окно
 *   меню уходит позже, чем закрывается само меню. Фокус ждёт его.
 *
 * `ownWindow` — поле живёт в своём окне `Modal` (панель комментариев). Фокус
 * главного окна `AppState` к нему не относится: пока панель открыта, главное
 * окно не в фокусе всегда, и ожидание его не кончилось бы никогда. Своё окно
 * панели фокус от меню получает обратно само — проверено на устройстве.
 */
export function focusWithKeyboard(
  ref: RefObject<TextInput | null>,
  afterFocus?: (input: TextInput) => void,
  ownWindow = false,
) {
  whenWindowFocused(() => {
    const input = ref.current;

    if (!input) return;

    if (input.isFocused()) KeyboardController.setFocusTo('current');
    else input.focus();

    afterFocus?.(input);
  }, ownWindow);
}

/** Только для тестов. */
export function setWindowFocusedForTests(focused: boolean) {
  windowFocused = focused;
}
