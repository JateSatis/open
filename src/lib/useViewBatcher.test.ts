import { act, renderHook } from '@testing-library/react-native';

import { useViewBatcher, type ViewRepeat } from './useViewBatcher';

jest.useFakeTimers();

async function setup(repeat: ViewRepeat) {
  const send = jest.fn((_items: { id: string }[], _session: string) => Promise.resolve());
  const hook = await renderHook(() => useViewBatcher({ isFocused: true, send, repeat }));

  return { send, hook };
}

const sent = (send: jest.Mock) =>
  send.mock.calls.map(([items]) => items.map(({ id }: { id: string }) => id));

describe('useViewBatcher', () => {
  it('копит показанное и отправляет пачкой после паузы', async () => {
    const { send, hook } = await setup('session');

    await act(() => hook.result.current.setVisible([{ id: 'a' }, { id: 'b' }]));
    expect(send).not.toHaveBeenCalled();

    await act(() => jest.advanceTimersByTime(2000));
    expect(sent(send)).toEqual([['a', 'b']]);
  });

  it('раз за сессию: ушедшее и вернувшееся не засчитывается снова', async () => {
    const { send, hook } = await setup('session');

    await act(() => hook.result.current.setVisible([{ id: 'a' }]));
    await act(() => jest.advanceTimersByTime(2000));
    await act(() => hook.result.current.setVisible([{ id: 'b' }]));
    await act(() => hook.result.current.setVisible([{ id: 'a' }]));
    await act(() => jest.advanceTimersByTime(2000));

    expect(sent(send)).toEqual([['a'], ['b']]);
  });

  it('за появление: поп, снова ставший активным, — новый показ', async () => {
    const { send, hook } = await setup('appearance');

    await act(() => hook.result.current.setVisible([{ id: 'a' }]));
    await act(() => jest.advanceTimersByTime(2000));
    await act(() => hook.result.current.setVisible([{ id: 'b' }]));
    await act(() => jest.advanceTimersByTime(2000));
    await act(() => hook.result.current.setVisible([{ id: 'a' }]));
    await act(() => jest.advanceTimersByTime(2000));

    expect(sent(send)).toEqual([['a'], ['b'], ['a']]);
  });

  it('при размонтировании отправляет сразу', async () => {
    const { send, hook } = await setup('appearance');

    await act(() => hook.result.current.setVisible([{ id: 'a' }]));
    await hook.unmount();

    expect(sent(send)).toEqual([['a']]);
  });
});
