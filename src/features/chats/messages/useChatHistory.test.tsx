import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { listMessages, type Message } from '@/api/chats';
import { useChatHistory } from '@/features/chats/messages/useChatHistory';
import { DeadlineError } from '@/lib/deadline';

jest.mock('@/api/chats', () => ({
  listMessages: jest.fn(),
  listMessagesSince: jest.fn(() => Promise.resolve([])),
  listDeletedMessageIds: jest.fn(() => Promise.resolve([])),
  listMessageEdits: jest.fn(() => Promise.resolve([])),
  listCommentCounts: jest.fn(() => Promise.resolve([])),
  listMessagesByIds: jest.fn(() => Promise.resolve([])),
  MESSAGE_PAGE_SIZE: 30,
}));
jest.mock('@/api/messageViews', () => ({ listMessageViews: jest.fn(() => Promise.resolve([])) }));
jest.mock('@/api/reactions', () => ({ listMessageReactions: jest.fn(() => Promise.resolve([])) }));

const mockedList = listMessages as jest.MockedFunction<typeof listMessages>;

function message(id: string, createdAt: string): Message {
  return {
    id,
    chatId: 'chat-1',
    authorId: 'user-2',
    kind: 'text',
    text: id,
    createdAt,
    editedAt: null,
    attachments: [],
    replies: [],
    forward: null,
    reactions: { members: {}, visitors: {}, mine: null },
    commentsCount: 0,
    viewsCount: 0,
    readAt: null,
  };
}

function renderHistory() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return renderHook(() => useChatHistory('chat-1'), { wrapper });
}

describe('useChatHistory: догрузка старых после сбоя', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedList.mockResolvedValueOnce({
      items: [message('new', '2026-10-12T10:00:00Z')],
      nextCursor: 'cursor-1',
    });
  });

  it('не повторяет упавшую догрузку сама, пока человек снова не полистает', async () => {
    const { result } = await renderHistory();
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    mockedList.mockRejectedValueOnce(new DeadlineError());
    await act(() => result.current.loadMore());

    expect(result.current.isLoadingMore).toBe(false);

    // Список зовёт догрузку, пока стоит у края, — без жеста запросов нет.
    await act(() => result.current.loadMore());
    expect(mockedList).toHaveBeenCalledTimes(2);

    mockedList.mockResolvedValueOnce({
      items: [message('old', '2026-10-11T10:00:00Z')],
      nextCursor: null,
    });
    await act(async () => result.current.resumeLoadMore(true));

    await waitFor(() => expect(result.current.items.map((item) => item.id)).toContain('old'));
    expect(mockedList).toHaveBeenCalledTimes(3);
  });

  it('первая загрузка не удалась — истории нет, это сбой, а не пустая переписка', async () => {
    mockedList.mockReset();
    mockedList.mockRejectedValue(new DeadlineError());

    const { result } = await renderHistory();

    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.items).toHaveLength(0);
  });
});
