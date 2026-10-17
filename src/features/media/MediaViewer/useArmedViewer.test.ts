import { act, renderHook } from '@testing-library/react-native';
import { Keyboard } from 'react-native';

import { useArmedViewer } from './useArmedViewer';

const tile = { x: 1, y: 2, width: 3, height: 4 };

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('useArmedViewer', () => {
  it('opens the viewer that was already getting ready under the finger', async () => {
    const { result } = await renderHook(() => useArmedViewer());

    await act(async () => result.current.arm(1, tile));
    expect(result.current.viewer).toEqual({ index: 1, origin: tile, armed: true });

    await act(async () => result.current.open(1, tile));
    expect(result.current.viewer).toEqual({ index: 1, origin: tile, armed: false });

    // Открытый просмотр «тапа не будет» не закрывает.
    await act(async () => result.current.disarm());
    expect(result.current.viewer?.armed).toBe(false);
  });

  it('drops a ready window nobody opened, so it never hangs over the screen', async () => {
    const { result } = await renderHook(() => useArmedViewer());

    await act(async () => result.current.arm(0, tile));
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    expect(result.current.viewer).toBeNull();
  });

  it('does not prepare a window while the keyboard is up', async () => {
    jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true);
    const { result } = await renderHook(() => useArmedViewer());

    await act(async () => result.current.arm(0, tile));

    expect(result.current.viewer).toBeNull();
  });
});
