import { act, renderHook } from '@testing-library/react-native';
import type { RefObject } from 'react';
import type { FlatList } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { useJumpToMessage } from './useJumpToMessage';

import type { ChatListRow } from '@/features/chats/islands/rows';

describe('useJumpToMessage', () => {
  async function setup(
    rows: readonly { key: string; message?: { seq: number }; island?: { seq: number } }[],
    loadWindow = jest.fn(async () => true),
    initiallyPositioned = true,
  ) {
    const list = {
      scrollToIndex: jest.fn(),
      scrollToOffset: jest.fn(),
    };
    const listRef = { current: list } as unknown as RefObject<FlatList<ChatListRow> | null>;
    const glide = { value: 0 } as unknown as SharedValue<number>;

    return {
      list,
      glide,
      ...(await renderHook(
        ({
          currentRows,
        }: {
          currentRows: readonly {
            key: string;
            message?: { seq: number };
            island?: { seq: number };
          }[];
        }) =>
          useJumpToMessage(listRef, currentRows, loadWindow, initiallyPositioned, glide, () => 800),
        { initialProps: { currentRows: rows } },
      )),
    };
  }

  it('scrolls a cached target once with a smooth centered movement', async () => {
    const loadWindow = jest.fn(async () => true);
    const { result, list } = await setup([{ key: 'target' }], loadWindow);

    await act(async () => {
      await result.current.jump('target', 12, { viewPosition: 0.5 });
    });

    expect(loadWindow).not.toHaveBeenCalled();
    expect(list.scrollToIndex).toHaveBeenCalledTimes(1);
    expect(list.scrollToIndex).toHaveBeenCalledWith({
      index: 0,
      viewPosition: 0.5,
      animated: true,
    });
  });

  it('positions a route-jump target instantly, without an internal scroll', async () => {
    const loadWindow = jest.fn(async () => true);
    const { result, list } = await setup([{ key: 'target' }], loadWindow, false);

    await act(async () => {
      await result.current.jump('target', 12, { viewPosition: 0.5 });
    });

    expect(loadWindow).not.toHaveBeenCalled();
    expect(list.scrollToIndex).toHaveBeenCalledTimes(1);
    expect(list.scrollToIndex).toHaveBeenCalledWith({
      index: 0,
      viewPosition: 0.5,
      animated: false,
    });
  });

  it('starts a distant cached jump immediately and positions the target without an animated correction', async () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({ key: `row-${index}` }));
    const { result, list } = await setup(rows);

    await act(async () => {
      await result.current.jump('row-25', 25);
    });

    expect(list.scrollToIndex).toHaveBeenCalledTimes(1);
    expect(list.scrollToIndex).toHaveBeenCalledWith({
      index: 25,
      viewPosition: 0.5,
      animated: false,
    });
    expect(result.current.positioned).toBe(false);
    expect(result.current.highlight).toBeNull();
    await act(async () => {
      result.current.onVisible(['row-25']);
    });
    expect(result.current.positioned).toBe(true);
    expect(result.current.highlight?.messageId).toBe('row-25');
  });

  it('hides a distant target and loads its window before any scroll', async () => {
    const loadWindow = jest.fn(async () => true);
    const { result, list } = await setup([], loadWindow);

    await act(async () => {
      await result.current.jump('target', 12);
    });

    expect(loadWindow).toHaveBeenCalledWith(12);
    // До того как окно ляжет в список, никакой прокрутки нет: цель не
    // показывается в неверной позиции и не подравнивается повторно.
    expect(list.scrollToIndex).not.toHaveBeenCalled();
    expect(result.current.positioned).toBe(false);
  });

  it('keeps the current list visible while a distant window is loading', async () => {
    let resolveWindow: (found: boolean) => void = () => {};
    const loadWindow = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveWindow = resolve;
        }),
    );
    const { result } = await setup([{ key: 'current' }], loadWindow);

    let flight: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      flight = result.current.jump('target', 1);
    });
    // Сразу при тапе спиннер не мигает: переписка остаётся на месте.
    expect(result.current.loading).toBe(false);
    expect(result.current.positioned).toBe(true);
    expect(result.current.transitioning).toBe(true);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveWindow(false);
      await flight;
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.transitioning).toBe(false);
  });

  it('waits for scrollToIndex retry before revealing list and starting glide on distant jump', async () => {
    const { result, list, rerender } = await setup([{ key: 'current', message: { seq: 100 } }]);

    await act(async () => {
      await result.current.jump('target', 10);
    });
    expect(result.current.positioned).toBe(false);
    expect(result.current.highlight).toBeNull();

    await rerender({
      currentRows: [
        { key: 'newer', message: { seq: 12 } },
        { key: 'target', message: { seq: 10 } },
        { key: 'older', message: { seq: 8 } },
      ],
    });

    expect(list.scrollToIndex).toHaveBeenCalledTimes(1);
    expect(list.scrollToIndex).toHaveBeenLastCalledWith({
      index: 1,
      viewPosition: 0.5,
      animated: false,
    });

    // На первом проходе VirtualizedList ещё не измерил далёкую строку и падает в scrollToOffset.
    await act(async () => {
      result.current.onScrollToIndexFailed({ index: 1, averageItemLength: 80 });
    });
    expect(list.scrollToOffset).toHaveBeenCalledWith({ offset: 80, animated: false });

    // Приблизительный scrollToOffset уже зацепил целевую строку краем экрана,
    // но точное позиционирование ещё впереди — раскрывать список и мигать рано.
    await act(async () => {
      result.current.onVisible(['target']);
    });
    expect(result.current.positioned).toBe(false);
    expect(result.current.highlight).toBeNull();

    // Таймер повтора докручивает список точно в центр и запускает рывок с подсветкой.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 35));
    });
    expect(list.scrollToIndex).toHaveBeenCalledTimes(2);
    expect(result.current.positioned).toBe(true);
    expect(result.current.highlight?.messageId).toBe('target');
  });

  it('waits for list content instead of retrying an unmeasured jump on a timer', async () => {
    const { result, list } = await setup([{ key: 'target' }]);

    await act(async () => {
      await result.current.jump('target', 12, { viewPosition: 0.5 });
    });
    await act(async () => { result.current.onScrollToIndexFailed({ index: 0, averageItemLength: 0 }); });

    expect(list.scrollToIndex).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.onListReady();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(list.scrollToIndex).toHaveBeenCalledTimes(2);
    expect(list.scrollToIndex).toHaveBeenLastCalledWith({
      index: 0,
      viewPosition: 0.5,
      animated: true,
    });
  });
});
