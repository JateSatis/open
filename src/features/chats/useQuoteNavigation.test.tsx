import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useQuoteNavigation } from './useQuoteNavigation';

import type { Channel } from '@/api/channels';
import type { ChatSummary } from '@/api/chats';
import { channelQueryKey } from '@/features/channels/keys';
import { chatQueryKey } from '@/features/chats/useChat';

type Route = { key: string; name: string; params?: Record<string, unknown> };

const mockPush = jest.fn();
const mockDispatch = jest.fn();
let mockStack: { index: number; routes: Route[] } = { index: 0, routes: [] };

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ getState: () => mockStack, dispatch: mockDispatch }),
  useRouter: () => ({ push: mockPush }),
}));
jest.mock('@/api/chats', () => ({ listDeletedMessageIds: jest.fn(() => Promise.resolve([])) }));

const POSTED_SEQ = 70;

const channel: Channel = {
  id: 'channel-1',
  title: 'Мой канал',
  description: null,
  username: 'my_channel',
  avatarUrl: null,
  ownerId: 'owner-1',
  postsChatId: 'posts-1',
  subscribersCount: 0,
  readersCount: 0,
};

const postsChat = {
  id: 'posts-1',
  kind: 'channel',
  channel: { id: 'channel-1', title: 'Мой канал', username: 'my_channel', avatarUrl: null },
} as ChatSummary;

let queryClient: QueryClient;
const jump = jest.fn(() => Promise.resolve(true));

async function renderNavigation(chatId = 'dialog-1') {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const { result } = await renderHook(
    () =>
      useQuoteNavigation(chatId, {
        jump,
        isHistoryReady: true,
        isFocused: true,
        focusComment: jest.fn(),
      }),
    { wrapper },
  );

  return result.current;
}

/** Переход «к оригиналу» ждёт ответа базы об удалённых. */
async function openPost(navigation: Awaited<ReturnType<typeof renderNavigation>>, id = 'p1') {
  await act(async () => {
    navigation.openOriginal({ id, chatId: 'posts-1', seq: POSTED_SEQ });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(42);
  queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  mockStack = {
    index: 0,
    routes: [{ key: 'dialog', name: '[chatId]', params: { chatId: 'dialog-1' } }],
  };
});

afterEach(() => {
  queryClient.clear();
  jest.restoreAllMocks();
});

describe('useQuoteNavigation: пост канала', () => {
  it('opens the channel screen with the jump straight away when the channel is cached', async () => {
    queryClient.setQueryData(chatQueryKey('posts-1'), postsChat);

    await openPost(await renderNavigation());

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/chats/channel/[channelId]',
      params: { channelId: 'channel-1', jumpTo: 'p1', jumpSeq: String(POSTED_SEQ), jumpKey: '42' },
    });
  });

  it('goes through the chat route, which redirects, when nothing about the chat is known', async () => {
    await openPost(await renderNavigation());

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/chats/[chatId]',
      params: { chatId: 'posts-1', jumpTo: 'p1', jumpSeq: String(POSTED_SEQ), jumpKey: '42' },
    });
  });

  it('returns to the channel screen below in the stack and hands it the new jump', async () => {
    queryClient.setQueryData(channelQueryKey('channel-1'), channel);
    mockStack = {
      index: 1,
      routes: [
        {
          key: 'channel',
          name: 'channel/[channelId]',
          params: { channelId: 'channel-1', jumpKey: '7' },
        },
        { key: 'dialog', name: '[chatId]', params: { chatId: 'dialog-1' } },
      ],
    };

    await openPost(await renderNavigation(), 'p9');

    expect(mockPush).not.toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenNthCalledWith(1, {
      type: 'SET_PARAMS',
      payload: {
        params: {
          jumpTo: 'p9',
          jumpSeq: String(POSTED_SEQ),
          comments: undefined,
          comment: undefined,
          jumpKey: '42',
        },
      },
      source: 'channel',
    });
    expect(mockDispatch).toHaveBeenNthCalledWith(2, { type: 'POP', payload: { count: 1 } });
  });

  it('opens a forwarded post comment on the channel screen with its sheet', async () => {
    queryClient.setQueryData(chatQueryKey('posts-1'), postsChat);
    const navigation = await renderNavigation();

    await act(async () =>
      navigation.openComment('posts-1', {
        messageId: 'p1',
        commentId: 'c1',
        target: { key: 'p1', seq: POSTED_SEQ },
      }),
    );

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/chats/channel/[channelId]',
      params: {
        channelId: 'channel-1',
        jumpTo: 'p1',
        jumpSeq: String(POSTED_SEQ),
        comments: 'p1',
        comment: 'c1',
        jumpKey: '42',
      },
    });
  });

  it('jumps in place inside the channel itself, without navigating', async () => {
    await openPost(await renderNavigation('posts-1'));

    expect(jump).toHaveBeenCalledWith('p1', POSTED_SEQ);
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
