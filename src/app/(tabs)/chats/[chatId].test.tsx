import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { act, fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';

import ChatScreen from './[chatId]';

import type { ChatChannelHandlers, ChatSummary, Message } from '@/api/chats';
import { getChat, listMessages, markChatRead, sendMessage, subscribeToChat } from '@/api/chats';
import { acceptInvite, declineInvite, getMyInvite } from '@/api/invites';
import { getProfile } from '@/api/profile';
import { useSession } from '@/features/auth/useSession';
import { formatMessageTime } from '@/features/chats/chatDisplay';
import { reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockPush = jest.fn();
const mockNavigate = jest.fn();

// Шапку экран ставит через Stack.Screen — мок рисует её прямо в дереве, чтобы
// статус собеседника и тап по шапке можно было проверить.
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ chatId: 'chat-1' }),
  useRouter: () => ({ push: mockPush, navigate: mockNavigate }),
  Stack: {
    Screen: ({ options }: { options?: { headerTitle?: () => React.ReactNode } }) =>
      options?.headerTitle ? options.headerTitle() : null,
  },
}));

jest.mock('@/api/profile', () => ({ getProfile: jest.fn() }));

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

jest.mock('@/api/invites', () => ({
  getMyInvite: jest.fn(),
  acceptInvite: jest.fn(),
  declineInvite: jest.fn(),
}));

// Этот экран не тестирует ни грид выбора медиа, ни просмотрщик — оба тянут
// за собой нативные модули (expo-video, expo-camera, expo-media-library…),
// которых в тестовом окружении нет и не должно быть. Мок обрывает эту
// цепочку на границе фичи, как и мок `@/api/chats` выше.
jest.mock('@/features/media', () => ({
  ...jest.requireActual('@/features/media/selectionStore'),
  assetPreviewUri: (asset: { id: string }) => asset.id,
  MediaGrid: () => null,
  MediaViewer: () => null,
  stopVoice: jest.fn(),
}));
jest.mock('@/features/media/HoldToRecordRow', () => ({
  HoldToRecordRow: ({ children }: { children: unknown }) => children,
}));
jest.mock('@/features/media/galleryPrefetch', () => ({ prefetchGallery: jest.fn() }));

const mockedGetChat = getChat as jest.MockedFunction<typeof getChat>;
const mockedListMessages = listMessages as jest.MockedFunction<typeof listMessages>;
const mockedSendMessage = sendMessage as jest.MockedFunction<typeof sendMessage>;
const mockedSubscribe = subscribeToChat as jest.MockedFunction<typeof subscribeToChat>;
const mockedMarkRead = markChatRead as jest.MockedFunction<typeof markChatRead>;
const mockedGetProfile = getProfile as jest.MockedFunction<typeof getProfile>;
const mockedSession = useSession as jest.MockedFunction<typeof useSession>;
const mockedMyInvite = getMyInvite as jest.MockedFunction<typeof getMyInvite>;
const mockedAccept = acceptInvite as jest.MockedFunction<typeof acceptInvite>;
const mockedDecline = declineInvite as jest.MockedFunction<typeof declineInvite>;
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
    waiting: [],
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
  resetConnectionState();
  reportRealtimeJoined();
  mockedListMessages.mockResolvedValue({ items: [], nextCursor: null });
  mockedGetChat.mockResolvedValue(chatWith([member, other]));
  mockedMyInvite.mockResolvedValue(null);
  mockedAccept.mockResolvedValue(undefined);
  mockedDecline.mockResolvedValue(undefined);
  mockedGetProfile.mockResolvedValue({
    id: 'user-2',
    username: 'marina',
    displayName: 'Марина',
    avatarUrl: null,
    bio: null,
    status: 'в отпуске до понедельника',
  });
  mockedSubscribe.mockImplementation((_chatId, given) => {
    handlers = given;
    return { broadcastTyping, unsubscribe };
  });
});

describe('ChatScreen', () => {
  it('shows the counterpart status in the header and opens their profile on tap', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByText('в отпуске до понедельника')).toBeTruthy();
    expect(mockedGetProfile).toHaveBeenCalledWith('user-2');

    await user.press(screen.getByLabelText('Профиль: Разговор'));
    expect(mockPush).toHaveBeenCalledWith('/chats/people/user-2');
  });

  it('opens the author profile from a tap on their avatar', async () => {
    mockedListMessages.mockResolvedValue({
      items: [message('m1', 'привет', 'user-2')],
      nextCursor: null,
    });
    const user = userEvent.setup();

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    await user.press(screen.getByLabelText('Профиль: Марина'));

    expect(mockPush).toHaveBeenCalledWith('/chats/people/user-2');
  });

  it('shows the conversation to anyone who opens it', async () => {
    mockedGetChat.mockResolvedValue(
      chatWith([
        other,
        { id: 'user-3', displayName: 'Пётр', avatarUrl: null, lastReadAt: READ_AT },
      ]),
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
    await screen.findByText(
      'Сообщений пока нет. Всё, что здесь появится, сможет прочитать кто угодно.',
    );

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
      chatWith([
        other,
        { id: 'user-3', displayName: 'Пётр', avatarUrl: null, lastReadAt: READ_AT },
      ]),
    );

    await renderWithQuery(<ChatScreen />);

    expect(
      await screen.findByText('Читать этот чат может кто угодно, писать — только участники.'),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Сообщение')).toBeNull();
  });

  it('offers the invitee to accept or decline instead of the composer', async () => {
    mockedGetChat.mockResolvedValue({ ...chatWith([other]), waiting: [member] });
    mockedMyInvite.mockResolvedValue({ status: 'pending', inviter: other });

    await renderWithQuery(<ChatScreen />);

    expect(
      await screen.findByText('Марина зовёт вас в этот чат. Примите заявку, чтобы писать.'),
    ).toBeTruthy();
    expect(screen.getByText('Отклонить')).toBeTruthy();
    expect(screen.queryByLabelText('Сообщение')).toBeNull();
    // Себя в «ждём ответа» приглашённый не видит: ответить — его ход.
    expect(screen.queryByText(/Ждём ответа/)).toBeNull();
  });

  it('lets the invitee write once they accept', async () => {
    mockedGetChat.mockResolvedValueOnce({ ...chatWith([other]), waiting: [member] });
    mockedMyInvite.mockResolvedValue({ status: 'pending', inviter: other });
    const user = userEvent.setup();

    await renderWithQuery(<ChatScreen />);
    await user.press(await screen.findByText('Принять'));

    expect(mockedAccept).toHaveBeenCalledWith('chat-1');
    expect(await screen.findByLabelText('Сообщение')).toBeTruthy();
  });

  it('lets the invitee take back a refusal but not refuse twice', async () => {
    mockedGetChat.mockResolvedValue({ ...chatWith([other]), waiting: [member] });
    mockedMyInvite.mockResolvedValue({ status: 'declined', inviter: other });

    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByText('Вы отклонили заявку. Её всё ещё можно принять.')).toBeTruthy();
    expect(screen.getByText('Принять')).toBeTruthy();
    expect(screen.queryByText('Отклонить')).toBeNull();
  });

  it('tells everyone who has not answered the invite yet', async () => {
    mockedGetChat.mockResolvedValue({ ...chatWith([member]), waiting: [other] });

    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByText('Ждём ответа на заявку: Марина')).toBeTruthy();
    // Создатель — участник и пишет сразу, не дожидаясь ответа.
    expect(screen.getByLabelText('Сообщение')).toBeTruthy();
  });

  it('refreshes the members when someone accepts while the chat is open', async () => {
    mockedGetChat.mockResolvedValueOnce({ ...chatWith([member]), waiting: [other] });

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('Ждём ответа на заявку: Марина');

    await act(async () => handlers?.onMembersChanged());

    await waitFor(() => expect(screen.queryByText(/Ждём ответа/)).toBeNull());
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

  it('turns an own message read as soon as the other side reports reading', async () => {
    mockedListMessages.mockResolvedValue({
      items: [message('m1', 'как дела', 'user-1')],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);
    expect(await screen.findByText('доставлено')).toBeTruthy();

    mockedGetChat.mockResolvedValue(
      chatWith([member, { ...other, lastReadAt: '2026-09-16T11:00:00Z' }]),
    );
    handlers?.onRead();

    expect(await screen.findByText('прочитано')).toBeTruthy();
  });

  it('marks the chat read when a message arrives while it is already open', async () => {
    mockedListMessages.mockResolvedValue({
      items: [message('m1', 'привет', 'user-2')],
      nextCursor: null,
    });
    listMessagesSince.mockResolvedValue([message('m2', 'ещё сообщение', 'user-2')]);

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    mockedMarkRead.mockClear();

    handlers?.onMessage();
    await screen.findByText('ещё сообщение');

    expect(mockedMarkRead).toHaveBeenCalledWith('chat-1');
  });

  it('marks a chat read even when the first message ever arrives into an empty one', async () => {
    // Пустой чат при открытии и он же с первым сообщением после рассылки:
    // дочитывать не от чего, поэтому страница читается заново.
    mockedListMessages
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockResolvedValueOnce({
        items: [message('m1', 'первое', 'user-2')],
        nextCursor: null,
      });

    await renderWithQuery(<ChatScreen />);
    await screen.findByLabelText('Сообщение');

    handlers?.onMessage();

    expect(await screen.findByText('первое')).toBeTruthy();
    expect(mockedMarkRead).toHaveBeenCalledWith('chat-1');
  });

  it('catches up on what it missed while the channel was gone', async () => {
    mockedListMessages.mockResolvedValue({
      items: [message('m1', 'привет', 'user-2')],
      nextCursor: null,
    });
    listMessagesSince.mockResolvedValue([message('m2', 'пока тебя не было', 'user-2')]);

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    handlers?.onReconnected?.();

    expect(await screen.findByText('пока тебя не было')).toBeTruthy();
  });

  it('sends what did not go through once the connection is back', async () => {
    mockedSendMessage.mockRejectedValueOnce(new Error('Network request failed'));
    const user = userEvent.setup();

    await renderWithQuery(<ChatScreen />);

    await user.type(await screen.findByLabelText('Сообщение'), 'как дела');
    await user.press(screen.getByText('Отправить'));
    await screen.findByText('Не отправлено. Повторить');

    mockedSendMessage.mockResolvedValueOnce(message('m9', 'как дела', 'user-1'));

    // Неудачная отправка уже перевела приложение в «нет сети» — осталось
    // вернуть связь.
    await act(() => reportRealtimeJoined());

    // Повторять вручную не приходится: человек уже нажал «отправить».
    await waitFor(() => expect(screen.queryByText('Не отправлено. Повторить')).toBeNull());
    expect(mockedSendMessage).toHaveBeenCalledTimes(2);
  });

  it('shows who is typing and unsubscribes from the channel on unmount', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByLabelText('Сообщение');

    handlers?.onTyping('user-2', 'typing');

    expect(await screen.findByText('Марина печатает…')).toBeTruthy();

    await screen.unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });
});
