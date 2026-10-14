// Жесты строки переписки в тестах: долгое нажатие — так, как его видит
// жест-обработчик, — открывает меню; выбор включается его пунктом «Выбрать».

import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

/** Долгое нажатие на строку: меню, а в режиме выбора — отметка. */
export async function longPressMessage(rowKey: string) {
  await act(async () => {
    fireGestureHandler(getByGestureTestId(`message-long-press-${rowKey}`), [
      { state: State.BEGAN },
      { state: State.ACTIVE },
      { state: State.END },
    ]);
  });
}

/** Меню строки → «Выбрать»: режим выбора с этой строкой отмеченной. */
export async function startSelecting(rowKey: string) {
  await longPressMessage(rowKey);
  fireEvent.press(await screen.findByRole('menuitem', { name: 'Выбрать' }));
  await waitFor(() => expect(screen.queryByTestId('message-menu')).toBeNull());
}
