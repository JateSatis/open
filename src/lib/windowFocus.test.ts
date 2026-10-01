import type { TextInput } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';

import { focusWithKeyboard, setWindowFocusedForTests } from './windowFocus';

function field(focused: boolean) {
  return {
    isFocused: jest.fn(() => focused),
    focus: jest.fn(),
  } as unknown as TextInput & { focus: jest.Mock };
}

function nextFrame() {
  jest.runOnlyPendingTimers();
}

describe('focusWithKeyboard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    setWindowFocusedForTests(true);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('фокусирует поле без фокуса', () => {
    const input = field(false);

    focusWithKeyboard({ current: input });
    nextFrame();

    expect(input.focus).toHaveBeenCalledTimes(1);
    expect(KeyboardController.setFocusTo).not.toHaveBeenCalled();
  });

  it('поле уже в фокусе, клавиатура спрятана — просит клавиатуру нативно, а не пустым focus()', () => {
    const input = field(true);

    focusWithKeyboard({ current: input });
    nextFrame();

    expect(input.focus).not.toHaveBeenCalled();
    expect(KeyboardController.setFocusTo).toHaveBeenCalledWith('current');
  });

  it('пока окно меню не ушло, фокус ждёт', () => {
    const input = field(false);

    setWindowFocusedForTests(false);
    focusWithKeyboard({ current: input });
    nextFrame();

    expect(input.focus).not.toHaveBeenCalled();
  });

  it('поле в своём окне Modal не ждёт фокуса главного окна — его там не будет', () => {
    const input = field(false);

    setWindowFocusedForTests(false);
    focusWithKeyboard({ current: input }, undefined, true);
    nextFrame();

    expect(input.focus).toHaveBeenCalled();
  });

  it('после фокуса отдаёт поле — например, чтобы поставить курсор', () => {
    const input = field(false);
    const after = jest.fn();

    focusWithKeyboard({ current: input }, after);
    nextFrame();

    expect(after).toHaveBeenCalledWith(input);
  });
});
