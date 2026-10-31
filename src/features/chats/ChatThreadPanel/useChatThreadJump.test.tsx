import { act, renderHook } from '@testing-library/react-native';
import type { FlatList } from 'react-native';

import { useChatThreadJump } from './useChatThreadJump';

import { PENDING_SEQ } from '@/api/pendingSeq';
import type { ChatThreadPaneRow } from '@/features/chats/chatThreads/useChatThreadPane';
import { original } from '@/test/islands';

const row = (id: string, seq: number): ChatThreadPaneRow => ({
  type: 'message', key: id, message: { ...original({ id, seq }), status: 'sending' }, chatThreadRoot: false,
});

it('свой новый ответ выводит в конец длинного треда, даже если человек читал начало', async () => {
  jest.useFakeTimers();
  const scrollToEnd = jest.fn();
  const listRef = { current: { scrollToEnd } as unknown as FlatList<ChatThreadPaneRow> };
  const { rerender, unmount } = await renderHook(({ rows }: { rows: ChatThreadPaneRow[] }) => useChatThreadJump({
    listRef, rows, loadUntil: async () => true, isLoading: false,
  }), { initialProps: { rows: [row('root', 1), row('old', 2)] } });

  await rerender({ rows: [row('root', 1), row('old', 2), row('mine', PENDING_SEQ + 1)] });
  await act(async () => { jest.runOnlyPendingTimers(); });
  expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
  await unmount();
  jest.useRealTimers();
});
