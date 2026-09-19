import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { fireEvent, screen, userEvent } from '@testing-library/react-native';

import ChatScreen from './[chatId]';

import type { ChatChannelHandlers, ChatSummary, Message } from '@/api/chats';
import { getChat, listMessages, markChatRead, sendMessage, subscribeToChat } from '@/api/chats';
import { useSession } from '@/features/auth/useSession';
import { formatMessageTime } from '@/features/chats/chatDisplay';
import { renderWithQuery } from '@/test/renderWithQuery';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ chatId: 'chat-1' }),
  Stack: { Screen: () => null },
}));

jest.mock('@/features/auth/useSession', () => ({
  useSession: jest.fn(),
}));

jest.mock('@/api/chats', () => ({
  getChat: jest.fn(),
  listMessages: jest.fn(),
  listMessagesSince: jest.fn(),
  markChatRead: jest.fn(),
  sendMessage: jest.fn(),
  subscribeToChat: jest.fn(),
  MESSAGE_PAGE_SIZE: 30,
}));

const mockedGetChat = getChat as jest.MockedFunction<typeof getChat>;
const mockedListMessages = listMessages as jest.MockedFunction<typeof listMessages>;
const mockedSendMessage = sendMessage as jest.MockedFunction<typeof sendMessage>;
const mockedSubscribe = subscribeToChat as jest.MockedFunction<typeof subscribeToChat>;
const mockedMarkRead = markChatRead as jest.MockedFunction<typeof markChatRead>;
const mockedSession = useSession as jest.MockedFunction<typeof useSession>;
const { listMessagesSince } = jest.requireMock('@/api/chats') as {
  listMessagesSince: jest.Mock;
};

const SENT_AT = '2026-09-16T10:00:00Z';
/** Раньше SENT_AT: по умолчанию собеседник до последнего сообщения не дочитал. */
const READ_AT = '2026-09-16T09:00:00Z';

const member = { id: 'user-1', displayName: 'Я', avatarUrl: null, lastReadAt: READ_AT };
const other = { id: 'user-2', displayName: 'Марина', avatarUrl: null, lastReadAt: READ_AT };

function chatWith(participants: ChatSummary['participants']): ChatSummary {
  return {
    id: 'chat-1',
    kind: 'direct',
    title: 'Разговор',
    participants,
    lastMessagePreview: null,
    lastMessageAt: null,
    lastMessageAuthorId: null,
    hasUnread: false,
  };
}

function message(id: string, text: string, authorId: string): Message {
  return {
    id,
    chatId: 'chat-1',
    authorId,
    kind: 'text',
    text,
    createdAt: SENT_AT,
    attachments: [],
  };
}

let handlers: ChatChannelHandlers | null = null;
const broadcastTyping = jest.fn();
const unsubscribe = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  handlers = null;
  mockedSession.mockReturnValue({
    session: { user: { id: 'user-1' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  listMessagesSince.mockResolvedValue([]);
  mockedMarkRead.mockResolvedValue(undefined);
  mockedListMessages.mockResolvedValue({ items: [], nextCursor: null });
  mockedGetChat.mockResolvedValue(chatWith([member, other]));
  mockedSubscribe.mockImplementation((_chatId, given) => {
    handlers = given;
    return { broadcastTyping, unsubscribe };
  });
});

describe('ChatScreen', () => {
  it('shows the conversation to anyone who opens it', async () => {
    mockedGetChat.mockResolvedValue(
      chatWith([other, { id: 'user-3', displayName: 'Пётр', avatarUrl: null, lastReadAt: READ_AT }]),
    );
    mockedListMessages.mockResolvedValue({
      items: [message('m1', 'привет', 'user-2')],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByText('привет')).toBeTruthy();
  });

  it('marks the chat read once its messages are on screen', async () => {
    mockedListMessages.mockResolvedValue({
      items: [message('m1', 'привет', 'user-2')],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    expect(mockedMarkRead).toHaveBeenCalledWith('chat-1');
  });

  it('does not mark an empty chat read', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('Сообщений пока нет. Всё, что здесь появится, сможет прочитать кто угодно.');

    expect(mockedMarkRead).not.toHaveBeenCalled();
  });

  it('shows an own message as delivered until the other side reads it', async () => {
    mockedListMessages.mockResolvedValue({
      items: [message('m1', 'как дела', 'user-1')],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByText('доставлено')).toBeTruthy();
    expect(screen.queryByText('прочитано')).toBeNull();
  });

  it('shows an own message as read once the other side has caught up', async () => {
    mockedGetChat.mockResolvedValue(
      chatWith([member, { ...other, lastReadAt: '2026-09-16T11:00:00Z' }]),
    );
    mockedListMessages.mockResolvedValue({
      items: [message('m1', 'как дела', 'user-1')],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByText('прочитано')).toBeTruthy();
  });

  it('never marks an incoming message as read or delivered', async () => {
    mockedListMessages.mockResolvedValue({
      items: [message('m1', 'привет', 'user-2')],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    expect(screen.queryByText('доставлено')).toBeNull();
    expect(screen.queryByText('прочитано')).toBeNull();
  });

  it('hides the composer from an outsider and says why', async () => {
    mockedGetChat.mockResolvedValue(
      chatWith([other, { id: 'user-3', displayName: 'Пётр', avatarUrl: null, lastReadAt: READ_AT }]),
    );

    await renderWithQuery(<ChatScreen />);

    expect(
      await screen.findByText('Читать этот чат может кто угодно, писать — только участники.'),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Сообщение')).toBeNull();
  });

  it('lets a member write and shows the message before the server answers', async () => {
    // Assigned inside the promise executor below.
    let resolveSend: (saved: Message) => void = () => {};
    mockedSendMessage.mockReturnValue(
      new Promise<Message>((resolve) => {
        resolveSend = resolve;
      }),
    );
    const user = userEvent.setup();

    await renderWithQuery(<ChatScreen />);

    await user.type(await screen.findByLabelText('Сообщение'), 'как дела');
    await user.press(screen.getByText('Отправить'));

    expect(screen.getByText('как дела')).toBeTruthy();
    expect(screen.getByText('Отправляется…')).toBeTruthy();

    resolveSend(message('m9', 'как дела', 'user-1'));

    expect(await screen.findByText(formatMessageTime(SENT_AT))).toBeTruthy();
    // Рассылку о новом сообщении делает триггер в базе, клиент лишь вставляет
    // строку — проверяем именно вставку.
    expect(mockedSendMessage).toHaveBeenCalledWith('chat-1', { text: 'как дела' });
  });

  it('marks the message as failed when the server rejects the insert', async () => {
    // What RLS returns when a non-member tries to write anyway — the button
    // being visible is never what decides whether a message is accepted.
    mockedSendMessage.mockRejectedValue(
      new Error('new row violates row-level security policy for table "messages"'),
    );
    const user = userEvent.setup();

    await renderWithQuery(<ChatScreen />);

    await user.type(await screen.findByLabelText('Сообщение'), 'как дела');
    await user.press(screen.getByText('Отправить'));

    expect(await screen.findByText('Не отправлено. Повторить')).toBeTruthy();
    expect(screen.getByText('как дела')).toBeTruthy();
  });

  it('retries a failed message on tap', async () => {
    mockedSendMessage
      .mockRejectedValueOnce(new Error('rls'))
      .mockResolvedValueOnce(message('m9', 'как дела', 'user-1'));
    const user = userEvent.setup();

    await renderWithQuery(<ChatScreen />);

    await user.type(await screen.findByLabelText('Сообщение'), 'как дела');
    await user.press(screen.getByText('Отправить'));
    await user.press(await screen.findByText('Не отправлено. Повторить'));

    expect(await screen.findByText(formatMessageTime(SENT_AT))).toBeTruthy();
    expect(mockedSendMessage).toHaveBeenCalledTimes(2);
  });

  it('pages further back through the history when the list is scrolled up', async () => {
    mockedListMessages.mockResolvedValueOnce({
      items: [message('m2', 'второе', 'user-2')],
      nextCursor: SENT_AT,
    });
    mockedListMessages.mockResolvedValueOnce({
      items: [message('m1', 'первое', 'user-2')],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('второе');

    fireEvent(screen.getByTestId('messages-list'), 'endReached');

    expect(await screen.findByText('первое')).toBeTruthy();
    expect(mockedListMessages).toHaveBeenLastCalledWith('chat-1', { cursor: SENT_AT });
  });

  it('pulls a broadcast message from the database instead of trusting the payload', async () => {
    mockedListMessages.mockResolvedValue({
      items: [message('m1', 'привет', 'user-2')],
      nextCursor: null,
    });
    listMessagesSince.mockResolvedValue([message('m2', 'ещё сообщение', 'user-2')]);

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    handlers?.onMessage();

    expect(await screen.findByText('ещё сообщение')).toBeTruthy();
    expect(listMessagesSince).toHaveBeenCalledWith('chat-1', SENT_AT);
  });

  it('shows who is typing and unsubscribes from the channel on unmount', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByLabelText('Сообщение');

    handlers?.onTyping('user-2');

    expect(await screen.findByText('Марина печатает…')).toBeTruthy();

    await screen.unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });
});
