jest.mock('@/api/historyWindow', () => ({
  getHistoryWindow: jest.fn((...args) => jest.requireActual('@/test/historyWindowMock').fixtureHistoryWindow(...args)),
  getHistoryGroupKeys: jest.fn(() => Promise.resolve([])),
  getHistoryItems: jest.fn(() => Promise.resolve([])),
}));
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
    seq: Date.parse(createdAt),
    createdAt,
    editedAt: null,
    edited: false,
    editMark: null,
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

describe('useChatHistory: догрузка старых', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedList.mockResolvedValueOnce({
      items: [message('new', '2026-10-12T10:00:00Z')],
      nextCursor: 1,
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

  it('свежий край запускает догрузку без ошибки, события делят один запрос и соблюдают курсор', async () => {
    const { result } = await renderHistory();
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    let complete!: (page: Awaited<ReturnType<typeof listMessages>>) => void;
    mockedList.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );

    await act(async () => result.current.resumeLoadMore(false));
    expect(mockedList).toHaveBeenCalledTimes(1);
    await act(async () => {
      result.current.resumeLoadMore(true);
      void result.current.loadMore();
      result.current.resumeLoadMore(true);
      void result.current.loadMore();
    });
    expect(mockedList).toHaveBeenCalledTimes(2);
    expect(mockedList).toHaveBeenLastCalledWith('chat-1', { cursor: 1 });
    expect(result.current.isLoadingMore).toBe(true);

    await act(async () =>
      complete({ items: [message('older', '2026-10-11T10:00:00Z')], nextCursor: 2 }),
    );
    await waitFor(() => expect(result.current.isLoadingMore).toBe(false));
    mockedList.mockResolvedValueOnce({
      items: [message('oldest', '2026-10-10T10:00:00Z')],
      nextCursor: null,
    });
    await act(() => result.current.loadMore());
    expect(mockedList).toHaveBeenLastCalledWith('chat-1', { cursor: 2 });
    expect(result.current.items.map(({ id }) => id)).toEqual(['new', 'older', 'oldest']);
    expect(result.current.hasMore).toBe(false);
    await act(async () => {
      result.current.resumeLoadMore(true);
      await result.current.loadMore();
    });
    expect(mockedList).toHaveBeenCalledTimes(3);
  });

  it('после ошибки автоматические события молчат, новый жест разрешает одну попытку', async () => {
    const { result } = await renderHistory();
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    mockedList.mockRejectedValue(new Error('server unavailable'));
    await act(() => result.current.loadMore());
    for (let i = 0; i < 5; i++) await act(() => result.current.loadMore());
    expect(mockedList).toHaveBeenCalledTimes(2);
    await act(async () => result.current.resumeLoadMore(true));
    await waitFor(() => expect(result.current.isLoadingMore).toBe(false));
    for (let i = 0; i < 5; i++) await act(() => result.current.loadMore());
    expect(mockedList).toHaveBeenCalledTimes(3);
    expect(result.current.error).not.toBeNull();
  });
});
