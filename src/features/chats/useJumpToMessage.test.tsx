import { act, renderHook } from '@testing-library/react-native';
import type { RefObject } from 'react';
import type { FlatList } from 'react-native';

import { useJumpToMessage } from './useJumpToMessage';

import type { ChatListRow } from '@/features/chats/islands/rows';

describe('useJumpToMessage', () => {
  async function setup(
    rows: readonly { key: string }[],
    loadWindow = jest.fn(async () => true),
    initiallyPositioned = true,
  ) {
    const list = {
      scrollToIndex: jest.fn(),
      scrollToOffset: jest.fn(),
    };
    const listRef = { current: list } as unknown as RefObject<FlatList<ChatListRow> | null>;

    return {
      list,
      ...(await renderHook(
        ({ currentRows }: { currentRows: readonly { key: string }[] }) =>
          useJumpToMessage(listRef, currentRows, loadWindow, initiallyPositioned),
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

  it('waits for list content instead of retrying an unmeasured jump on a timer', async () => {
    const { result, list } = await setup([{ key: 'target' }]);

    await act(async () => {
      await result.current.jump('target', 12, { viewPosition: 0.5 });
    });
    act(() => result.current.onScrollToIndexFailed({ index: 0, averageItemLength: 0 }));

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
