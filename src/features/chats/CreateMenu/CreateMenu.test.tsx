import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';

import { CreateMenu } from '.';

import { Sizes, Spacing } from '@/theme';

// Кнопка «+» на экране 750×1334: правый край в 16 dp от края, низ — в 16 dp.
const BUTTON = { x: 750 - 16 - 56, y: 1334 - 16 - 56, width: 56, height: 56 };

type Measure = (callback: (x: number, y: number, width: number, height: number) => void) => void;

let spy: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  spy = jest
    .spyOn(View.prototype as unknown as { measureInWindow: Measure }, 'measureInWindow')
    .mockImplementation((callback) => callback(BUTTON.x, BUTTON.y, BUTTON.width, BUTTON.height));
});

afterEach(() => {
  spy.mockRestore();
  jest.useRealTimers();
});

/** Анимация закрытия и следующий кадр, на котором выполняется действие. */
async function finishClosing() {
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
}

describe('CreateMenu', () => {
  it('opens a menu with «Групповой чат» above «Канал»', async () => {
    await render(<CreateMenu onSelect={jest.fn()} />);

    expect(screen.queryByTestId('create-menu')).toBeNull();

    await fireEvent.press(screen.getByTestId('create-button'));

    const items = screen.getAllByRole('menuitem').map((item) => item.props.accessibilityLabel);

    expect(items).toEqual(['Групповой чат', 'Канал']);
  });

  it('stands above the button, with the left margin equal to the button right margin', async () => {
    await render(<CreateMenu onSelect={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('create-button'));

    const style = StyleSheet.flatten(screen.getByTestId('create-menu').props.style);
    const menuHeight = 2 * Sizes.menuRowHeight + Spacing.one * 2;

    expect(style.left).toBe(16);
    expect((style.top as number) + menuHeight).toBeLessThan(BUTTON.y);
  });

  it('runs the chosen item only after the menu has closed', async () => {
    const onSelect = jest.fn();

    await render(<CreateMenu onSelect={onSelect} />);
    await fireEvent.press(screen.getByTestId('create-button'));
    await fireEvent.press(screen.getByLabelText('Канал'));

    expect(onSelect).not.toHaveBeenCalled();

    await finishClosing();

    expect(onSelect).toHaveBeenCalledWith('channel');
    expect(screen.queryByTestId('create-menu')).toBeNull();
  });

  it('closes on a tap past the menu without choosing anything', async () => {
    const onSelect = jest.fn();

    await render(<CreateMenu onSelect={onSelect} />);
    await fireEvent.press(screen.getByTestId('create-button'));
    await fireEvent.press(screen.getByTestId('create-menu-backdrop'));
    await finishClosing();

    expect(screen.queryByTestId('create-menu')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
