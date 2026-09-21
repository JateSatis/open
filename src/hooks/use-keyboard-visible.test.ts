import { act, renderHook } from '@testing-library/react-native';
import { Keyboard } from 'react-native';

import { useKeyboardVisible } from './use-keyboard-visible';

const listeners = new Map<string, () => void>();
const remove = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  listeners.clear();
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((name: string, handler: () => void) => {
    listeners.set(name, handler);
    return { remove };
  }) as unknown as typeof Keyboard.addListener);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useKeyboardVisible', () => {
  it('starts hidden', async () => {
    const { result } = await renderHook(() => useKeyboardVisible());

    expect(result.current).toBe(false);
  });

  it('follows the keyboard appearing and going away', async () => {
    const { result } = await renderHook(() => useKeyboardVisible());

    // Имена событий зависят от платформы — проверяем поведение, а не то, какое
    // из двух имён подставилось.
    const [showEvent, hideEvent] = [...listeners.keys()];

    expect(showEvent).toMatch(/keyboard(Will|Did)Show/);
    expect(hideEvent).toMatch(/keyboard(Will|Did)Hide/);

    await act(() => listeners.get(showEvent)?.());
    expect(result.current).toBe(true);

    await act(() => listeners.get(hideEvent)?.());
    expect(result.current).toBe(false);
  });

  it('leaves no listeners behind on unmount', async () => {
    const { unmount } = await renderHook(() => useKeyboardVisible());

    await unmount();

    expect(remove).toHaveBeenCalledTimes(2);
  });
});
