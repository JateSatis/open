jest.mock('@/api/historyWindow', () => ({
  getHistoryWindow: jest.fn((...args) => jest.requireActual('@/test/historyWindowMock').fixtureHistoryWindow(...args)),
  getHistoryGroupKeys: jest.fn(() => Promise.resolve([])),
  getHistoryItems: jest.fn(() => Promise.resolve([])),
}));
import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  userEvent,
  waitFor,
  within,
} from '@testing-library/react-native';

import ChatScreen from './[chatId]';

import type { ChatChannelHandlers, ChatSummary, Message } from '@/api/chats';
import { getChat, listMessages, markChatRead, sendMessage, subscribeToChat } from '@/api/chats';
import { acceptInvite, declineInvite, getMyInvite } from '@/api/invites';
import { listMessageViews } from '@/api/messageViews';
import { getProfile } from '@/api/profile';
import { useSession } from '@/features/auth/useSession';
import { formatMessageTime } from '@/features/chats/chatDisplay';
import { resetComposerDrafts } from '@/features/chats/composerDraftStore';
import { resetOutbox } from '@/features/chats/messages/outbox';
import { reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { DeadlineError } from '@/lib/deadline';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockPush = jest.fn();
const mockNavigate = jest.fn();

// Шапку экран ставит через Stack.Screen — мок рисует её прямо в дереве, чтобы
// статус собеседника и тап по шапке можно было проверить.
jest.mock('@/api/messageViews');
jest.mock('@/api/reactions', () => ({
  ...jest.requireActual('@/api/reactionCounts'),
  listMessageReactions: jest.fn(() => Promise.resolve([])),
  setMessageReaction: jest.fn(),
}));
jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useNavigation: () => ({
    getState: () => ({ index: 0, routes: [] }),
    dispatch: jest.fn(),
    addListener: () => () => undefined,
  }),
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

jest.mock('@/api/streams');

jest.mock('@/api/chats', () => ({
  getChat: jest.fn(),
  listMessages: jest.fn(),
  listMessagesSince: jest.fn(),
  markChatRead: jest.fn(),
  sendMessage: jest.fn(),
  subscribeToChat: jest.fn(),
  deleteMessages: jest.fn(),
  listDeletedMessageIds: jest.fn(),
  listMessageEdits: jest.fn(() => Promise.resolve([])),
  listCommentCounts: jest.fn(() => Promise.resolve([])),
  listMessagesByIds: jest.fn(() => Promise.resolve([])),
  editMessage: jest.fn(),
  MESSAGE_PAGE_SIZE: 30,
}));

// Панель комментариев в этих тестах не открывается — её сеть здесь не нужна.
jest.mock('@/api/comments', () => ({
  getPinnedComment: jest.fn(() => Promise.resolve(null)),
  pinComment: jest.fn(() => Promise.resolve()),
  unpinComment: jest.fn(() => Promise.resolve()),
  listComments: jest.fn(() => Promise.resolve({ items: [], nextCursor: null })),
  getCommentTarget: jest.fn(() => Promise.resolve({ state: 'missing' })),
  subscribeToComments: jest.fn(() => () => undefined),
}));
jest.mock('@/api/pins', () => ({
  listPinnedMessages: jest.fn(() => Promise.resolve([])),
  pinMessage: jest.fn(),
  unpinMessage: jest.fn(),
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
  ...jest.requireActual('@/test/outgoingMediaMock').outgoingMediaMock,
  ...jest.requireActual('@/features/media/selectionStore'),
  assetPreviewUri: (asset: { id: string }) => asset.id,
  MediaGrid: () => null,
  MediaViewer: () => null,
  stopVoice: jest.fn(),
}));
jest.mock('@/features/media/HoldToRecordRow', () => ({
  // Строка ввода как есть; справа — «Отправить», когда она стоит на месте микрофона.
  HoldToRecordRow: ({ children, trailing }: { children: unknown; trailing?: unknown }) =>
    jest.requireActual('react').createElement(
      jest.requireActual('react').Fragment,
      null,
      children,
      trailing,
    ),
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
    ownerId: null,
    description: null,
    avatarUrl: null,
    title: 'Разговор',
    participants,
    waiting: [],
    lastMessagePreview: null,
    lastMessageAt: null,
    lastMessageAuthorId: null,
    lastPopAt: null,
    lastActivityAt: null,
    listPosition: null,
    enteredAt: null,
    previewIsPop: false,
    subscription: null,
    hasUnread: false,
    subscribersCount: 0,
    username: null,
    channel: null,
  };
}

function message(id: string, text: string, authorId: string): Message {
  return {
    id,
    chatId: 'chat-1',
    authorId,
    kind: 'text',
    text,
    seq: Date.parse(SENT_AT),
    createdAt: SENT_AT,
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

let handlers: ChatChannelHandlers | null = null;
const broadcastTyping = jest.fn();
const unsubscribe = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  handlers = null;
  // Исходящие и черновики живут вне экрана, в сторах, — между тестами их надо чистить.
  resetOutbox();
  resetComposerDrafts();
  mockedSession.mockReturnValue({
    session: { user: { id: 'user-1' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  listMessagesSince.mockResolvedValue([]);
  (listMessageViews as jest.Mock).mockResolvedValue([]);
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
  it('shows the counterpart status in the header and opens the chat info page on tap', async () => {
    const user = userEvent.setup();

    await renderWithQuery(<ChatScreen />);

    // Рядом со статусом собеседника — число подписчиков переписки.
    expect(await screen.findByText('в отпуске до понедельника · 0 подписчиков')).toBeTruthy();
    expect(mockedGetProfile).toHaveBeenCalledWith('user-2');

    // Свой диалог, как и группа, ведёт на страницу информации, а не в профиль.
    await user.press(screen.getByLabelText('О чате: Разговор'));
    expect(mockPush).toHaveBeenCalledWith('/chats/chat-info/chat-1');
  });

  it('opens «О чате» from a tap on the header of a group', async () => {
    mockedGetChat.mockResolvedValue({ ...chatWith([member, other]), kind: 'group' });
    const user = userEvent.setup();

    await renderWithQuery(<ChatScreen />);
    await user.press(await screen.findByLabelText('О чате: Разговор'));

    expect(mockPush).toHaveBeenCalledWith('/chats/chat-info/chat-1');
    expect(screen.queryByLabelText('Профиль: Разговор')).toBeNull();
  });

  it('draws the group photo in the header, or the first letter of its title', async () => {
    mockedGetChat.mockResolvedValue({
      ...chatWith([member, other]),
      kind: 'group',
      avatarUrl: 'https://x/g.jpg',
    });

    const { unmount } = await renderWithQuery(<ChatScreen />);
    await screen.findByLabelText('О чате: Разговор');

    // Фото подписано названием группы; буквы на его месте нет.
    expect(screen.getByLabelText('Разговор')).toBeTruthy();
    expect(screen.queryByText('Р')).toBeNull();
    await unmount();

    mockedGetChat.mockResolvedValue({ ...chatWith([member, other]), kind: 'group' });
    await renderWithQuery(<ChatScreen />);
    await screen.findByLabelText('О чате: Разговор');

    expect(screen.getByText('Р')).toBeTruthy();
  });

  it('opens «О чате» for an outsider of a group too', async () => {
    mockedGetChat.mockResolvedValue({
      ...chatWith([other, { ...other, id: 'user-3', displayName: 'Олег' }]),
      kind: 'group',
    });
    const user = userEvent.setup();

    await renderWithQuery(<ChatScreen />);
    await user.press(await screen.findByLabelText('О чате: Разговор'));

    expect(mockPush).toHaveBeenCalledWith('/chats/chat-info/chat-1');
  });

  it('opens the author profile from a tap on their avatar in a group', async () => {
    mockedGetChat.mockResolvedValue({ ...chatWith([member, other]), kind: 'group' });
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

  it('участник личного диалога не видит у собеседника ни имени, ни аватара', async () => {
    mockedListMessages.mockResolvedValue({
      items: [message('m1', 'привет', 'user-2')],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    expect(screen.queryByLabelText('Профиль: Марина')).toBeNull();
    expect(within(screen.getByTestId('message-bubble')).queryByText('Марина')).toBeNull();
  });

  it('посторонний видит чужой личный диалог как группу: у обоих имя и аватар', async () => {
    const petr = { id: 'user-3', displayName: 'Пётр', avatarUrl: null, lastReadAt: READ_AT };
    mockedGetChat.mockResolvedValue(chatWith([other, petr]));
    mockedListMessages.mockResolvedValue({
      items: [message('m1', 'привет', 'user-2'), message('m2', 'здравствуй', 'user-3')],
      nextCursor: null,
    });
    const user = userEvent.setup();

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    const bubbles = screen.getAllByTestId('message-bubble');
    expect(bubbles.map((bubble) => within(bubble).queryByText(/Марина|Пётр/) !== null)).toEqual([
      true,
      true,
    ]);
    expect(screen.getByLabelText('Профиль: Пётр')).toBeTruthy();

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

  it('does not read the entire chat merely by mounting the list', async () => {
    mockedListMessages.mockResolvedValue({
      items: [message('m1', 'привет', 'user-2')],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    expect(mockedMarkRead).not.toHaveBeenCalled();
  });

  it('does not mark an empty chat read', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText(
      'Сообщений пока нет. Всё, что здесь появится, сможет прочитать кто угодно.',
    );

    expect(mockedMarkRead).not.toHaveBeenCalled();
  });

  it('shows an own message with one check until another member sees it', async () => {
    mockedListMessages.mockResolvedValue({
      items: [message('m1', 'как дела', 'user-1')],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByText(formatMessageTime(SENT_AT))).toBeTruthy();
    expect(screen.getByLabelText('Отправлено')).toBeTruthy();
    expect(screen.queryByLabelText('Прочитано')).toBeNull();
  });

  it('shows an own message as read once another member has seen it', async () => {
    mockedListMessages.mockResolvedValue({
      items: [{ ...message('m1', 'как дела', 'user-1'), readAt: '2026-09-16T11:00:00Z' }],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByLabelText('Прочитано')).toBeTruthy();
  });

  it('never marks an incoming message as read', async () => {
    mockedListMessages.mockResolvedValue({
      items: [{ ...message('m1', 'привет', 'user-2'), readAt: '2026-09-16T11:00:00Z' }],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    expect(screen.queryByLabelText('Прочитано')).toBeNull();
  });

  it('shows the views count in the bubble and hides it while there are none', async () => {
    mockedListMessages.mockResolvedValue({
      items: [
        { ...message('m2', 'новое', 'user-1'), viewsCount: 0 },
        { ...message('m1', 'популярное', 'user-2'), viewsCount: 1250 },
      ],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByLabelText('Просмотры: 1250')).toBeTruthy();
    expect(screen.getByText('1,2K')).toBeTruthy();
    expect(screen.getAllByTestId('message-views')).toHaveLength(1);
  });

  it('offers an outsider «Подписаться» instead of the composer', async () => {
    mockedGetChat.mockResolvedValue(
      chatWith([
        other,
        { id: 'user-3', displayName: 'Пётр', avatarUrl: null, lastReadAt: READ_AT },
      ]),
    );

    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByTestId('chat-subscribe-button')).toBeTruthy();
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
    await user.press(screen.getByLabelText('Отправить'));

    expect(screen.getByText('как дела')).toBeTruthy();
    expect(screen.getByLabelText('Отправляется')).toBeTruthy();
    expect(screen.queryByText('Отправляется…')).toBeNull();

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
    await user.press(screen.getByLabelText('Отправить'));

    expect(await screen.findByLabelText('Не отправлено. Повторить')).toBeTruthy();
    expect(screen.getByText('как дела')).toBeTruthy();
  });

  it('retries a failed message on tap', async () => {
    mockedSendMessage
      .mockRejectedValueOnce(new Error('rls'))
      .mockResolvedValueOnce(message('m9', 'как дела', 'user-1'));
    const user = userEvent.setup();

    await renderWithQuery(<ChatScreen />);

    await user.type(await screen.findByLabelText('Сообщение'), 'как дела');
    await user.press(screen.getByLabelText('Отправить'));
    await user.press(await screen.findByLabelText('Не отправлено. Повторить'));

    expect(await screen.findByText(formatMessageTime(SENT_AT))).toBeTruthy();
    expect(mockedSendMessage).toHaveBeenCalledTimes(2);
  });

  it('pages further back through the history when the list is scrolled up', async () => {
    mockedListMessages.mockResolvedValueOnce({
      items: [message('m2', 'второе', 'user-2')],
      nextCursor: Date.parse(SENT_AT),
    });
    mockedListMessages.mockResolvedValueOnce({
      items: [message('m1', 'первое', 'user-2')],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('второе');

    fireEvent(screen.getByTestId('messages-list'), 'endReached');

    expect(await screen.findByText('первое')).toBeTruthy();
    expect(mockedListMessages).toHaveBeenLastCalledWith('chat-1', { cursor: Date.parse(SENT_AT) });
  });

  it.each(['scrollEndDrag', 'momentumScrollEnd', 'scrollBeginDrag'])(
    'loads at the physical history edge on %s without onEndReached or another gesture',
    async (event) => {
      mockedListMessages.mockResolvedValueOnce({
        items: [message('m2', 'второе', 'user-2')],
        nextCursor: 2,
      });
      mockedListMessages.mockResolvedValueOnce({
        items: [message('m1', 'первое', 'user-2')],
        nextCursor: null,
      });
      await renderWithQuery(<ChatScreen />);
      await screen.findByText('второе');

      const geometry = (y: number) => ({
        nativeEvent: {
          contentOffset: { x: 0, y },
          contentSize: { width: 400, height: 4000 },
          layoutMeasurement: { width: 400, height: 800 },
        },
      });
      await fireEvent(screen.getByTestId('messages-list'), event, geometry(1000));
      expect(mockedListMessages).toHaveBeenCalledTimes(1);
      await fireEvent(screen.getByTestId('messages-list'), event, geometry(3200));

      expect(await screen.findByText('первое')).toBeTruthy();
      expect(mockedListMessages).toHaveBeenLastCalledWith('chat-1', { cursor: 2 });
      await fireEvent(screen.getByTestId('messages-list'), event, geometry(3200));
      expect(mockedListMessages).toHaveBeenCalledTimes(2);
    },
  );

  it('prefetches once during a drag and can continue at the new physical edge when the fling stops', async () => {
    mockedListMessages
      .mockResolvedValueOnce({ items: [message('m3', 'третье', 'user-2')], nextCursor: 3 })
      .mockResolvedValueOnce({ items: [message('m2', 'второе', 'user-2')], nextCursor: 2 })
      .mockResolvedValueOnce({ items: [message('m1', 'первое', 'user-2')], nextCursor: null });
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('третье');
    const list = screen.getByTestId('messages-list');
    const geometry = (y: number, h: number) => ({
      nativeEvent: {
        contentOffset: { x: 0, y },
        contentSize: { width: 400, height: h },
        layoutMeasurement: { width: 400, height: 800 },
      },
    });
    await fireEvent(list, 'scrollBeginDrag', geometry(400, 4000));
    await fireEvent(list, 'scroll', geometry(2200, 4000));
    await screen.findByText('второе');
    await fireEvent(list, 'scroll', geometry(3300, 4800));
    await fireEvent(list, 'endReached');
    expect(mockedListMessages).toHaveBeenCalledTimes(2);
    await fireEvent(list, 'momentumScrollEnd', geometry(4000, 4800));
    expect(await screen.findByText('первое')).toBeTruthy();
    expect(mockedListMessages).toHaveBeenCalledTimes(3);
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
    expect(listMessagesSince).toHaveBeenCalledWith('chat-1', Date.parse(SENT_AT));
  });

  it('turns an own message read as soon as another member sees it', async () => {
    mockedListMessages.mockResolvedValue({
      items: [message('m1', 'как дела', 'user-1')],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);
    expect(await screen.findByText(formatMessageTime(SENT_AT))).toBeTruthy();

    (listMessageViews as jest.Mock).mockResolvedValue([
      { id: 'm1', viewsCount: 1, readAt: '2026-09-16T11:00:00Z' },
    ]);
    await act(async () => handlers?.onViewsChanged?.(['m1']));

    expect(await screen.findByLabelText('Прочитано')).toBeTruthy();
    expect(screen.getByLabelText('Просмотры: 1')).toBeTruthy();
  });

  it('does not translate an incoming broadcast into a read-all', async () => {
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

    expect(mockedMarkRead).not.toHaveBeenCalled();
  });

  it('does not mark a previously empty chat read on delivery alone', async () => {
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
    expect(mockedMarkRead).not.toHaveBeenCalled();
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
    await user.press(screen.getByLabelText('Отправить'));
    await screen.findByLabelText('Не отправлено. Повторить');

    mockedSendMessage.mockResolvedValueOnce(message('m9', 'как дела', 'user-1'));

    // Неудачная отправка уже перевела приложение в «нет сети» — осталось
    // вернуть связь.
    await act(() => reportRealtimeJoined());

    // Повторять вручную не приходится: человек уже нажал «отправить».
    await waitFor(() => expect(screen.queryByLabelText('Не отправлено. Повторить')).toBeNull());
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

describe('ChatScreen: не удалось загрузить', () => {
  const EMPTY = 'Сообщений пока нет. Всё, что здесь появится, сможет прочитать кто угодно.';

  it('сервер не ответил, показать нечего — «не удалось» и «Повторить», без пустого состояния', async () => {
    mockedGetChat.mockRejectedValue(new DeadlineError());
    mockedListMessages.mockRejectedValue(new DeadlineError());

    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByText('Не удалось загрузить переписку')).toBeTruthy();
    expect(screen.getByText('Повторить')).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByLabelText('Сообщение')).toBeNull();
  });

  it('«Повторить» начинает новую попытку и открывает переписку', async () => {
    mockedGetChat.mockRejectedValueOnce(new DeadlineError());
    mockedListMessages.mockResolvedValue({
      items: [message('m1', 'привет', 'user-2')],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);
    await fireEvent.press(await screen.findByText('Повторить'));

    expect(await screen.findByText('привет')).toBeTruthy();
    // Первая попытка упала, вторую начала кнопка, а не ожидание старой.
    expect(mockedGetChat.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('Не удалось загрузить переписку')).toBeNull();
  });

  it('не загрузилась только история — тоже экран сбоя, а не «сообщений пока нет»; повтор её дочитывает', async () => {
    mockedListMessages.mockRejectedValueOnce(new DeadlineError()).mockResolvedValue({
      items: [message('m1', 'привет', 'user-2')],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByText('Не удалось загрузить переписку')).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();

    await fireEvent.press(screen.getByText('Повторить'));

    expect(await screen.findByText('привет')).toBeTruthy();
    expect(mockedListMessages).toHaveBeenCalledTimes(2);
  });

  it('посетитель после повтора видит переписку только для чтения', async () => {
    const stranger = chatWith([
      other,
      { id: 'user-3', displayName: 'Пётр', avatarUrl: null, lastReadAt: READ_AT },
    ]);
    mockedGetChat.mockRejectedValueOnce(new DeadlineError()).mockResolvedValue(stranger);
    mockedListMessages.mockResolvedValue({
      items: [message('m1', 'привет', 'user-2')],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);
    await fireEvent.press(await screen.findByText('Повторить'));

    expect(await screen.findByText('привет')).toBeTruthy();
    expect(await screen.findByTestId('chat-subscribe-button')).toBeTruthy();
    expect(screen.queryByLabelText('Сообщение')).toBeNull();
  });

  it('обновление поверх загруженной переписки упало — сообщения остаются, экрана сбоя нет', async () => {
    mockedListMessages.mockResolvedValue({
      items: [message('m1', 'привет', 'user-2')],
      nextCursor: null,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    await render(
      <QueryClientProvider client={queryClient}>
        <ChatScreen />
      </QueryClientProvider>,
    );
    await screen.findByText('привет');

    mockedGetChat.mockRejectedValue(new DeadlineError());
    listMessagesSince.mockRejectedValue(new DeadlineError());
    await act(() => queryClient.invalidateQueries());

    await waitFor(() => expect(listMessagesSince).toHaveBeenCalled());
    expect(screen.getByText('привет')).toBeTruthy();
    expect(screen.queryByText('Не удалось загрузить переписку')).toBeNull();
    expect(screen.queryByText('Повторить')).toBeNull();
  });
});
