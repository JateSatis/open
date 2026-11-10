import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { getHistoryWindow, type HistoryWindow } from '@/api/historyWindow';
import { island, original } from '@/test/islands';
import { historyFixtureItems } from '@/test/historyWindowMock';
import { mergeMessages, messagesQueryKey, type ChatHistory } from '../messages/historyCache';
import { useSelectForwardGroup } from './useSelectForwardGroup';

jest.mock('@/api/historyWindow', () => ({ getHistoryWindow: jest.fn() }));
jest.mock('@/api/chats', () => ({ MESSAGE_PAGE_SIZE: 30 }));
jest.mock('@/features/notifications/alertsStore', () => ({ showNotice: jest.fn() }));
it('explicitly loads all group pages without injecting the group into unrelated thread caches', async () => {
  const group = island(
    'group',
    '2026-11-10T12:00:00Z',
    Array.from({ length: 65 }, (_, i) => original({ id: `original-${i}` })),
  );
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const empty: ChatHistory = { items: [], nextCursor: null };
  client.setQueryData(
    messagesQueryKey('chat-1'),
    mergeMessages(
      empty,
      [{ ...group, forward: { ...group.forward!, items: group.forward!.items.slice(50) } }],
      'older',
    ),
  );
  client.setQueryData(messagesQueryKey('chat-1', 'chat-threads'), empty);
  jest.mocked(getHistoryWindow).mockImplementation(async (_chat, request = { mode: 'latest' }) => {
    const start = request.mode === 'around' ? 0 : request.cursor!.position + 1;
    const end = Math.min(65, start + (request.limit ?? 30));
    return {
      items: historyFixtureItems([
        { ...group, forward: { ...group.forward!, items: group.forward!.items.slice(start, end) } },
      ]),
      after:
        end < 65
          ? { chatId: 'chat-1', direction: 'after', seq: group.seq, position: end - 1 }
          : null,
    } as HistoryWindow;
  });
  const start = jest.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = await renderHook(() => useSelectForwardGroup(start, 'user-2'), { wrapper });
  await act(() => result.current({ ...group, status: 'sent' }));
  expect(start.mock.calls[0][0]).toHaveLength(65);
  expect(new Set(start.mock.calls[0][0]).size).toBe(65);
  expect(getHistoryWindow).toHaveBeenCalledTimes(4);
  expect(client.getQueryData(messagesQueryKey('chat-1', 'chat-threads'))).toBe(empty);
  expect(
    client.getQueryData<ChatHistory>(messagesQueryKey('chat-1'))!.items[0].forward!.items,
  ).toHaveLength(65);
  client.clear();
});
