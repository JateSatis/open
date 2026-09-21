import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useChats } from './useChats';

import { listChats, type ChatSummary } from '@/api/chats';
import {
  reportRealtimeJoined,
  reportRequestFailed,
  resetConnectionState,
} from '@/features/connection/connectionStore';

jest.mock('@/api/chats', () => ({
  listChats: jest.fn(),
}));

const mockedListChats = listChats as jest.MockedFunction<typeof listChats>;

const chat: ChatSummary = {
  id: 'chat-1',
  kind: 'direct',
  title: null,
  participants: [],
  lastMessagePreview: 'до встречи',
  lastMessageAt: '2026-09-16T10:00:00Z',
  lastMessageAuthorId: 'user-2',
  hasUnread: false,
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetConnectionState();
  reportRealtimeJoined();
});

describe('useChats', () => {
  it('reports a failure only when there is nothing to show instead', async () => {
    mockedListChats.mockRejectedValue(new Error('unexpected token'));

    const { result } = await renderHook(() => useChats(), { wrapper });

    await waitFor(() => expect(result.current.error).toBe('Не удалось загрузить чаты'));
  });

  it('keeps quiet while the connection is known to be down', async () => {
    mockedListChats.mockRejectedValue(new Error('unexpected token'));
    reportRequestFailed();

    const { result } = await renderHook(() => useChats(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // Об обрыве говорит шапка; вторая надпись о том же ничего не добавляет.
    expect(result.current.error).toBeNull();
  });

  it('does not spin the refresh control for an update nobody asked for', async () => {
    mockedListChats.mockResolvedValue([chat]);

    const { result } = await renderHook(() => useChats(), { wrapper });

    await waitFor(() => expect(result.current.chats).toHaveLength(1));
    expect(result.current.isRefreshing).toBe(false);
  });

  it('spins it when the list is pulled by hand', async () => {
    mockedListChats.mockResolvedValue([chat]);

    const { result } = await renderHook(() => useChats(), { wrapper });

    await waitFor(() => expect(result.current.chats).toHaveLength(1));

    // Второй вызов держим незавершённым, иначе крутилка гаснет в том же такте
    // и поймать её включённой невозможно.
    let finish: (chats: ChatSummary[]) => void = () => {};
    mockedListChats.mockReturnValueOnce(
      new Promise<ChatSummary[]>((resolve) => {
        finish = resolve;
      }),
    );

    result.current.refresh();

    await waitFor(() => expect(result.current.isRefreshing).toBe(true));

    finish([chat]);

    await waitFor(() => expect(result.current.isRefreshing).toBe(false));
  });
});
