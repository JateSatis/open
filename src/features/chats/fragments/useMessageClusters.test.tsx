import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useMessageClusters } from './useMessageClusters';

import { subscribeToChatSignals } from '@/api/chats';
import type { ChatTopicListener } from '@/api/chatTopics';
import { listMessageClusters, type FragmentCluster } from '@/api/fragmentClusters';

jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/api/fragmentClusters', () => ({ listMessageClusters: jest.fn() }));
jest.mock('@/api/chats', () => ({ subscribeToChatSignals: jest.fn() }));

const mockedList = jest.mocked(listMessageClusters);
const mockedAcquire = jest.mocked(subscribeToChatSignals);
const release = jest.fn();
let listener: ChatTopicListener | null = null;

const cluster: FragmentCluster = {
  id: 'k1',
  messageId: 'm1',
  start: 0,
  end: 5,
  quote: 'Огонь',
  popularity: 1,
  memberReactions: {},
  visitorReactions: { '🔥': 1 },
  reactionsCount: 1,
  commentsCount: 0,
  peopleCount: 1,
  fragmentsCount: 1,
  mine: null,
  myFragmentId: null,
  decisionId: null,
};

const message = { id: 'm1', chatId: 'c1', text: 'Огонь и вода', clustersCount: 1 };

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  return Wrapper;
}

beforeEach(() => {
  jest.clearAllMocks();
  listener = null;
  mockedList.mockResolvedValue([cluster]);
  mockedAcquire.mockImplementation((_chat, l) => {
    listener = l;
    return release;
  });
});

describe('useMessageClusters', () => {
  it('loads the displayed clusters of a message with fragments', async () => {
    const { result } = await renderHook(() => useMessageClusters(message), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.data).toEqual([cluster]));
    expect(mockedList).toHaveBeenCalledWith('m1', 'Огонь и вода');
  });

  it('does not ask while the message has no visible fragments, but asks on the first signal', async () => {
    await renderHook(() => useMessageClusters({ ...message, clustersCount: 0 }), {
      wrapper: wrapper(),
    });

    expect(mockedList).not.toHaveBeenCalled();

    // Первая реакция на облачко, загруженное без фрагментов: пересчёт сообщает
    // о кластере — облачко его спрашивает.
    listener?.onClustersChanged?.('m1');
    await waitFor(() => expect(mockedList).toHaveBeenCalledWith('m1', 'Огонь и вода'));
  });

  it('reloads when the server says the clusters of this message changed', async () => {
    const { result } = await renderHook(() => useMessageClusters(message), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mockedAcquire).toHaveBeenCalledWith('c1', expect.anything());

    listener?.onClustersChanged?.('other-message');
    expect(mockedList).toHaveBeenCalledTimes(1);

    listener?.onClustersChanged?.('m1');
    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(2));
  });

  it('lets the chat topic go when the bubble goes away', async () => {
    const { result, unmount } = await renderHook(() => useMessageClusters(message), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    await unmount();

    expect(release).toHaveBeenCalled();
  });
});
