import { act, renderHook } from '@testing-library/react-native';

import type { AnchorRect } from '@/features/chats/MessageContextMenu';
import { useMessageMenu } from '@/features/chats/useMessageMenu';

const anchor = { x: 0, y: 100, width: 200, height: 50, touchY: 120 };
const viewport = { x: 0, y: 80, width: 400, height: 600 };

/** Замер окна, ответ на который отдаём вручную. */
function deferredMeasure() {
  const pending: ((rect: AnchorRect | null) => void)[] = [];
  const measure = jest.fn(() => new Promise<AnchorRect | null>((resolve) => pending.push(resolve)));

  return { measure, answer: (index: number) => pending[index](viewport) };
}

describe('useMessageMenu', () => {
  it('opens once the list window is measured, with that window', async () => {
    const { measure, answer } = deferredMeasure();
    const { result } = await renderHook(() => useMessageMenu<string>(measure));

    await act(() => result.current.open('m1', anchor));
    expect(result.current.target).toBeNull();

    await act(async () => answer(0));

    expect(result.current.target).toEqual({ item: 'm1', anchor, viewport });
  });

  it('does not open when it was closed before the measurement came back', async () => {
    const { measure, answer } = deferredMeasure();
    const { result } = await renderHook(() => useMessageMenu<string>(measure));

    await act(() => result.current.open('m1', anchor));
    await act(() => result.current.close());
    await act(async () => answer(0));

    expect(result.current.target).toBeNull();
  });

  it('opens over the latest tap when two answers race', async () => {
    const { measure, answer } = deferredMeasure();
    const { result } = await renderHook(() => useMessageMenu<string>(measure));

    await act(() => result.current.open('m1', anchor));
    await act(() => result.current.open('m2', anchor));
    await act(async () => answer(1));
    await act(async () => answer(0));

    expect(result.current.target?.item).toBe('m2');
  });
});
