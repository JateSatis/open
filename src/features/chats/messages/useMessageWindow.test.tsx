import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { listMessagesAfter, listMessagesAround, MESSAGE_WINDOW_NEWER_SIZE, type Message } from '@/api/chats';
import { messageWindowKey, messagesQueryKey, type ChatHistory } from './historyCache';
import { useMessageWindow } from './useMessageWindow';

jest.mock('@/api/chats', () => ({
  listMessagesAfter: jest.fn(),
  listMessagesAround: jest.fn(),
  listMessages: jest.fn(),
  MESSAGE_WINDOW_NEWER_SIZE: 12,
}));

const around = listMessagesAround as jest.MockedFunction<typeof listMessagesAround>;
const after = listMessagesAfter as jest.MockedFunction<typeof listMessagesAfter>;

function message(seq: number): Message {
  return {
    id: `m-${seq}`, chatId: 'chat-1', authorId: 'user-1', kind: 'text', text: `${seq}`,
    seq, createdAt: '2026-11-03T10:00:00Z', editedAt: null, edited: false, editMark: null,
    attachments: [], replies: [], forward: null,
    reactions: { members: {}, visitors: {}, mine: null },
    commentsCount: 0, viewsCount: 0, readAt: null,
  };
}

async function renderWindow(tail?: ChatHistory) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 1000 } } });
  if (tail) client.setQueryData(messagesQueryKey('chat-1'), tail);
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const rendered = await renderHook(() => useMessageWindow('chat-1', 10, tail), { wrapper });
  return { ...rendered, client };
}

describe('окно сообщений', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('кладёт соседей по обе стороны цели в порядке от новых к старым', async () => {
    around.mockResolvedValue({
      older: { items: [message(10), message(9)], nextCursor: 9 },
      newer: [message(11), message(12)],
    });
    const { result } = await renderWindow();
    await waitFor(() => expect(result.current.history?.items.map((item) => item.seq)).toEqual([12, 11, 10, 9]));
    expect(result.current.history?.newerCursor).toBeNull();
    expect(around).toHaveBeenCalledTimes(1);
  });

  it('не приклеивает живой хвост к оторванному окну, затем сливает их у края', async () => {
    around.mockResolvedValue({
      older: { items: [message(10)], nextCursor: 10 },
      newer: Array.from({ length: MESSAGE_WINDOW_NEWER_SIZE }, (_, index) => message(11 + index)),
    });
    after.mockResolvedValue([message(23), message(24)]);
    const tail: ChatHistory = { items: [{ ...message(25), status: 'sent' }, { ...message(24), status: 'sent' }], nextCursor: 24 };
    const { result, client } = await renderWindow(tail);
    await waitFor(() => expect(result.current.history?.newerCursor).toBe(22));
    expect(result.current.history?.items[0].seq).toBe(22);
    expect(client.getQueryData<ChatHistory>(messagesQueryKey('chat-1'))?.items[0].seq).toBe(25);

    await act(() => result.current.loadNewer());
    await waitFor(() => expect(result.current.history?.newerCursor).toBeNull());
    expect(result.current.history?.items.slice(0, 4).map((item) => item.seq)).toEqual([25, 24, 23, 22]);
    expect(client.getQueryData<ChatHistory>(messageWindowKey('chat-1', 10))?.nextCursor).toBe(10);
  });

  it('показывает сбой вместо бесконечной загрузки', async () => {
    around.mockRejectedValue(new Error('offline'));
    const { result } = await renderWindow();
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.isLoading).toBe(false);
  });
});
