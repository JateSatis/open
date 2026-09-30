import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useReactToMessage } from './useReactToMessage';

import { listMessages, subscribeToChat, type ChatChannelHandlers, type Message } from '@/api/chats';
import type { MessageReactions } from '@/api/reactionCounts';
import { listMessageReactions, setMessageReaction } from '@/api/reactions';
import { useChatMessages } from '@/features/chats/useChatMessages';
import { resetPendingReactions } from '@/features/interactions/pendingReactions';
import { useInAppAlert } from '@/features/notifications/alertsStore';

jest.mock('@/api/reactions', () => ({
  ...jest.requireActual('@/api/reactionCounts'),
  listMessageReactions: jest.fn(),
  setMessageReaction: jest.fn(),
}));
jest.mock('@/api/chats', () => ({
  listMessages: jest.fn(),
  listMessagesSince: jest.fn(() => Promise.resolve([])),
  subscribeToChat: jest.fn(),
  listDeletedMessageIds: jest.fn(() => Promise.resolve([])),
  listMessageEdits: jest.fn(() => Promise.resolve([])),
  listCommentCounts: jest.fn(() => Promise.resolve([])),
  listMessagesByIds: jest.fn(() => Promise.resolve([])),
  MESSAGE_PAGE_SIZE: 30,
}));
jest.mock('@/api/pins', () => ({ listPinnedMessages: jest.fn(() => Promise.resolve([])) }));
// Отправка медиа здесь не участвует — плеер и загрузчик не нужны.
jest.mock('@/features/media', () => ({
  uploadAllMedia: jest.fn(),
  removeUploadedMedia: jest.fn(),
}));

const mockedListMessages = listMessages as jest.MockedFunction<typeof listMessages>;
const mockedSubscribe = subscribeToChat as jest.MockedFunction<typeof subscribeToChat>;
const mockedSet = setMessageReaction as jest.MockedFunction<typeof setMessageReaction>;
const mockedList = listMessageReactions as jest.MockedFunction<typeof listMessageReactions>;

const EMPTY: MessageReactions = { members: {}, visitors: {}, mine: null };

function message(id: string, reactions: MessageReactions = EMPTY): Message {
  return {
    id,
    chatId: 'chat-1',
    authorId: 'user-2',
    kind: 'text',
    text: id,
    createdAt: `2026-09-30T10:0${id.slice(-1)}:00Z`,
    editedAt: null,
    attachments: [],
    replies: [],
    forward: null,
    reactions,
    commentsCount: 0,
  };
}

let handlers: ChatChannelHandlers | null = null;

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

async function renderChat(isMember: boolean) {
  const view = await renderHook(
    () => ({
      chat: useChatMessages('chat-1', 'user-1'),
      react: useReactToMessage('chat-1', isMember),
    }),
    { wrapper },
  );

  await waitFor(() => expect(view.result.current.chat.isLoading).toBe(false));

  return view;
}

function reactionsOf(
  result: { current: { chat: { messages: { id: string; reactions: MessageReactions }[] } } },
  id: string,
) {
  return result.current.chat.messages.find((item) => item.id === id)!.reactions;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetPendingReactions();
  useInAppAlert.setState({ alert: null });
  handlers = null;
  mockedListMessages.mockResolvedValue({
    items: [message('m2'), message('m1', { members: { '👍': 1 }, visitors: {}, mine: null })],
    nextCursor: null,
  });
  mockedSubscribe.mockImplementation((_chatId, next) => {
    handlers = next;
    return { broadcastTyping: jest.fn(), unsubscribe: jest.fn() };
  });
  mockedList.mockResolvedValue([]);
});

describe('reacting to a message', () => {
  it('shows my reaction at once, before the server answers', async () => {
    let answer: (value: { emoji: string; audience: 'member' }) => void = () => undefined;
    mockedSet.mockReturnValue(new Promise((resolve) => (answer = resolve)));

    const { result } = await renderChat(true);

    await act(async () =>
      result.current.react.toggle({ id: 'm1', reactions: reactionsOf(result, 'm1') }, '👍'),
    );

    expect(reactionsOf(result, 'm1')).toEqual({
      members: { '👍': 2 },
      visitors: {},
      mine: { emoji: '👍', audience: 'member' },
    });
    expect(mockedSet).toHaveBeenCalledWith('m1', '👍');

    await act(async () => answer({ emoji: '👍', audience: 'member' }));

    // Подтверждённое — в кеше, наложение снято, и ничего не удвоилось.
    expect(reactionsOf(result, 'm1').members).toEqual({ '👍': 2 });
  });

  it('puts a visitor reaction into the visitors row', async () => {
    mockedSet.mockResolvedValue({ emoji: '🔥', audience: 'visitor' });

    const { result } = await renderChat(false);

    await act(async () =>
      result.current.react.toggle({ id: 'm1', reactions: reactionsOf(result, 'm1') }, '🔥'),
    );

    expect(reactionsOf(result, 'm1')).toEqual({
      members: { '👍': 1 },
      visitors: { '🔥': 1 },
      mine: { emoji: '🔥', audience: 'visitor' },
    });
  });

  it('takes the row from the server when it differs from the guess', async () => {
    // Заявку приняли, а экран ещё считает меня посетителем.
    mockedSet.mockResolvedValue({ emoji: '🔥', audience: 'member' });

    const { result } = await renderChat(false);

    await act(async () =>
      result.current.react.toggle({ id: 'm1', reactions: reactionsOf(result, 'm1') }, '🔥'),
    );

    expect(reactionsOf(result, 'm1')).toEqual({
      members: { '👍': 1, '🔥': 1 },
      visitors: {},
      mine: { emoji: '🔥', audience: 'member' },
    });
  });

  it('tapping my own reaction again takes it off', async () => {
    mockedListMessages.mockResolvedValue({
      items: [
        message('m1', {
          members: { '👍': 2 },
          visitors: {},
          mine: { emoji: '👍', audience: 'member' },
        }),
      ],
      nextCursor: null,
    });
    mockedSet.mockResolvedValue(null);

    const { result } = await renderChat(true);

    await act(async () =>
      result.current.react.toggle({ id: 'm1', reactions: reactionsOf(result, 'm1') }, '👍'),
    );

    expect(mockedSet).toHaveBeenCalledWith('m1', null);
    expect(reactionsOf(result, 'm1')).toEqual({ members: { '👍': 1 }, visitors: {}, mine: null });
  });

  it('rolls back and says so when the server refuses', async () => {
    mockedSet.mockRejectedValue(new Error('boom'));

    const { result } = await renderChat(true);

    await act(async () =>
      result.current.react.toggle({ id: 'm1', reactions: reactionsOf(result, 'm1') }, '🔥'),
    );

    expect(reactionsOf(result, 'm1')).toEqual({ members: { '👍': 1 }, visitors: {}, mine: null });
    expect(useInAppAlert.getState().alert).toMatchObject({
      kind: 'notice',
      tone: 'error',
      text: 'Не удалось поставить реакцию',
    });
  });

  it('keeps one request in flight and sends only the last choice after it', async () => {
    const answers: ((value: { emoji: string; audience: 'member' } | null) => void)[] = [];
    mockedSet.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));

    const { result } = await renderChat(true);
    const tap = (emoji: string) =>
      act(async () =>
        result.current.react.toggle({ id: 'm1', reactions: reactionsOf(result, 'm1') }, emoji),
      );

    await tap('🔥');
    await tap('😁');
    await tap('🎉');

    expect(mockedSet).toHaveBeenCalledTimes(1);
    expect(reactionsOf(result, 'm1').mine?.emoji).toBe('🎉');

    await act(async () => answers[0]({ emoji: '🔥', audience: 'member' }));

    expect(mockedSet).toHaveBeenCalledTimes(2);
    expect(mockedSet).toHaveBeenLastCalledWith('m1', '🎉');
    // Пока второй едет, экран показывает последнее желаемое, а не промежуточное.
    expect(reactionsOf(result, 'm1').members).toEqual({ '👍': 1, '🎉': 1 });

    await act(async () => answers[1]({ emoji: '🎉', audience: 'member' }));

    expect(reactionsOf(result, 'm1')).toEqual({
      members: { '👍': 1, '🎉': 1 },
      visitors: {},
      mine: { emoji: '🎉', audience: 'member' },
    });
  });
});

describe('reactions from others in real time', () => {
  it('re-reads a burst of events as one batch', async () => {
    const { result } = await renderChat(true);

    mockedList.mockResolvedValue([
      { id: 'm1', reactions: { members: { '👍': 4 }, visitors: { '🔥': 2 }, mine: null } },
      { id: 'm2', reactions: { members: {}, visitors: { '😁': 1 }, mine: null } },
    ]);

    await act(async () => {
      handlers!.onReactionsChanged('m1');
      handlers!.onReactionsChanged('m1');
      handlers!.onReactionsChanged('m2');
      handlers!.onReactionsChanged('m1');
    });

    // Сразу база не дёргается: события копятся в пачку.
    expect(mockedList).not.toHaveBeenCalled();

    await waitFor(() => expect(reactionsOf(result, 'm1').members).toEqual({ '👍': 4 }));
    expect(reactionsOf(result, 'm2').visitors).toEqual({ '😁': 1 });
    expect(mockedList).toHaveBeenCalledTimes(1);
    expect(mockedList).toHaveBeenCalledWith(['m1', 'm2']);
  });

  it('ignores events about messages that are not loaded', async () => {
    await renderChat(true);

    await act(async () => handlers!.onReactionsChanged('far-away'));
    await act(() => new Promise((resolve) => setTimeout(resolve, 700)));

    expect(mockedList).not.toHaveBeenCalled();
  });

  it('catches up on counters after a reconnect', async () => {
    const { result } = await renderChat(true);

    mockedList.mockResolvedValue([
      { id: 'm1', reactions: { members: { '👍': 7 }, visitors: {}, mine: null } },
    ]);

    await act(async () => handlers!.onReconnected?.());

    await waitFor(() => expect(reactionsOf(result, 'm1').members).toEqual({ '👍': 7 }));
    expect(mockedList).toHaveBeenCalledWith(['m2', 'm1']);
  });
});
