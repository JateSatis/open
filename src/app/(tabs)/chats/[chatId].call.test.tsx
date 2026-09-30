import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import ChatScreen from './[chatId]';

import type { ChatChannelHandlers, ChatSummary, Message } from '@/api/chats';
import { getChat, listMessages, subscribeToChat } from '@/api/chats';
import { listPinnedMessages } from '@/api/pins';
import { fetchLiveStream, startCall, type LiveStream } from '@/api/streams';
import { useSession } from '@/features/auth/useSession';
import { resetComposerDrafts } from '@/features/chats/composerDraftStore';
import { resetOutbox } from '@/features/chats/messages/outbox';
import { reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { ensureCallMicrophone } from '@/features/streams/callPermissions';
import { joinCall } from '@/features/streams/callSession';
import { setCall } from '@/features/streams/callStore';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({
    getState: () => ({ index: 0, routes: [] }),
    dispatch: jest.fn(),
    addListener: () => () => undefined,
  }),
  useLocalSearchParams: () => ({ chatId: 'chat-1' }),
  useRouter: () => ({
    push: mockPush,
    navigate: jest.fn(),
    back: jest.fn(),
    canGoBack: () => true,
  }),
  router: { push: jest.fn() },
  Stack: {
    Screen: ({
      options,
    }: {
      options?: { headerTitle?: () => React.ReactNode; headerRight?: () => React.ReactNode };
    }) => (
      <>
        {options?.headerTitle ? options.headerTitle() : null}
        {options?.headerRight ? options.headerRight() : null}
      </>
    ),
  },
}));

jest.mock('@/api/profile', () => ({ getProfile: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@/features/auth/useSession', () => ({ useSession: jest.fn() }));
jest.mock('@/api/streams');
jest.mock('@/features/streams/callSession', () => ({
  joinCall: jest.fn(() => Promise.resolve()),
  leaveCall: jest.fn(),
}));
jest.mock('@/features/streams/callPermissions', () => ({
  ensureCallMicrophone: jest.fn(() => Promise.resolve(true)),
  askNotificationsOnce: jest.fn(),
}));
jest.mock('@/api/chats', () => ({
  getChat: jest.fn(),
  listMessages: jest.fn(),
  listMessagesSince: jest.fn(() => Promise.resolve([])),
  markChatRead: jest.fn(() => Promise.resolve()),
  subscribeToChat: jest.fn(),
  listDeletedMessageIds: jest.fn(() => Promise.resolve([])),
  listMessageEdits: jest.fn(() => Promise.resolve([])),
  listCommentCounts: jest.fn(() => Promise.resolve([])),
  listMessagesByIds: jest.fn(() => Promise.resolve([])),
  MESSAGE_PAGE_SIZE: 30,
}));
jest.mock('@/api/reactions', () => ({
  ...jest.requireActual('@/api/reactionCounts'),
  listMessageReactions: jest.fn(() => Promise.resolve([])),
}));
jest.mock('@/api/comments', () => ({
  listComments: jest.fn(() => Promise.resolve({ items: [], nextCursor: null })),
  getCommentTarget: jest.fn(() => Promise.resolve({ state: 'missing' })),
  subscribeToComments: jest.fn(() => () => undefined),
}));
jest.mock('@/api/pins', () => ({ listPinnedMessages: jest.fn() }));
jest.mock('@/api/invites', () => ({ getMyInvite: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@/features/media', () => ({
  ...jest.requireActual('@/features/media/selectionStore'),
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
const mockedSubscribe = subscribeToChat as jest.MockedFunction<typeof subscribeToChat>;
const mockedPins = listPinnedMessages as jest.MockedFunction<typeof listPinnedMessages>;
const mockedSession = useSession as jest.MockedFunction<typeof useSession>;
const mockedLiveStream = fetchLiveStream as jest.MockedFunction<typeof fetchLiveStream>;
const mockedStartCall = startCall as jest.MockedFunction<typeof startCall>;
const mockedJoin = joinCall as jest.MockedFunction<typeof joinCall>;
const mockedMicrophone = ensureCallMicrophone as jest.MockedFunction<typeof ensureCallMicrophone>;

const AT = '2026-10-01T10:00:00Z';
const me = { id: 'user-1', displayName: 'Я', avatarUrl: null, lastReadAt: AT };
const marina = { id: 'user-2', displayName: 'Марина', avatarUrl: null, lastReadAt: AT };

const chat: ChatSummary = {
  id: 'chat-1',
  kind: 'direct',
  title: null,
  participants: [me, marina],
  waiting: [],
  lastMessagePreview: null,
  lastMessageAt: null,
  lastMessageAuthorId: null,
  hasUnread: false,
};

const liveStream: LiveStream = {
  id: 'stream-1',
  chatId: 'chat-1',
  hostId: 'user-2',
  startedAt: new Date().toISOString(),
  speakersCount: 2,
  listenersCount: 12,
};

function message(overrides: Partial<Message>): Message {
  return {
    id: 'm1',
    chatId: 'chat-1',
    authorId: 'user-2',
    kind: 'text',
    text: 'привет',
    createdAt: AT,
    editedAt: null,
    attachments: [],
    replies: [],
    forward: null,
    reactions: { members: {}, visitors: {}, mine: null },
    commentsCount: 0,
    ...overrides,
  };
}

let handlers: ChatChannelHandlers | null = null;

function signInAs(userId: string) {
  mockedSession.mockReturnValue({
    session: { user: { id: userId } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  handlers = null;
  setCall(null);
  resetOutbox();
  resetComposerDrafts();
  resetConnectionState();
  reportRealtimeJoined();
  signInAs('user-1');
  mockedGetChat.mockResolvedValue(chat);
  mockedListMessages.mockResolvedValue({ items: [message({})], nextCursor: null });
  mockedPins.mockResolvedValue([]);
  mockedLiveStream.mockResolvedValue(null);
  mockedMicrophone.mockResolvedValue(true);
  mockedSubscribe.mockImplementation((_chatId, given) => {
    handlers = given;
    return { broadcastTyping: jest.fn(), unsubscribe: jest.fn() };
  });
  jest
    .spyOn(BackHandler, 'addEventListener')
    .mockImplementation(() => ({ remove: () => undefined }));
});

describe('кнопка «Позвонить»', () => {
  it('есть у участника чата', async () => {
    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByRole('button', { name: 'Позвонить' })).toBeTruthy();
  });

  it('нет у посетителя — звонок начинают только участники', async () => {
    signInAs('user-3');

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    expect(screen.queryByTestId('call-button')).toBeNull();
  });

  it('спрашивает микрофон, начинает звонок и входит в него', async () => {
    await renderWithQuery(<ChatScreen />);

    fireEvent.press(await screen.findByRole('button', { name: 'Позвонить' }));

    await waitFor(() => expect(mockedJoin).toHaveBeenCalled());
    expect(mockedMicrophone).toHaveBeenCalled();
    expect(mockedStartCall).toHaveBeenCalledWith('chat-1');
    expect(mockedJoin).toHaveBeenCalledWith({
      streamId: 'stream-1',
      chatId: 'chat-1',
      chatTitle: 'Марина',
      isDirect: true,
    });
    expect(mockPush).toHaveBeenCalledWith('/call');
  });

  it('без микрофона звонок не создаётся', async () => {
    mockedMicrophone.mockResolvedValue(false);

    await renderWithQuery(<ChatScreen />);

    fireEvent.press(await screen.findByRole('button', { name: 'Позвонить' }));

    await waitFor(() => expect(mockedMicrophone).toHaveBeenCalled());
    expect(mockedStartCall).not.toHaveBeenCalled();
    expect(mockedJoin).not.toHaveBeenCalled();
  });

  it('при идущем звонке ведёт в него, а не создаёт новый', async () => {
    mockedLiveStream.mockResolvedValue(liveStream);

    await renderWithQuery(<ChatScreen />);

    fireEvent.press(await screen.findByRole('button', { name: 'Присоединиться к звонку' }));

    await waitFor(() => expect(mockedJoin).toHaveBeenCalled());
    expect(mockedStartCall).not.toHaveBeenCalled();
    expect(mockedJoin.mock.calls[0][0].streamId).toBe('stream-1');
  });
});

describe('полоса звонка', () => {
  it('у участника: сколько в звонке и сколько слушают, тап — войти говорящим', async () => {
    mockedLiveStream.mockResolvedValue(liveStream);

    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByText('Идёт звонок · 2 в звонке · 12 слушают')).toBeTruthy();
    expect(screen.getByText('Войти')).toBeTruthy();

    fireEvent.press(screen.getByTestId('chat-call-bar'));

    await waitFor(() => expect(mockedJoin).toHaveBeenCalled());
    expect(mockedMicrophone).toHaveBeenCalled();
  });

  it('у посетителя та же полоса, тап подключает слушателем без микрофона', async () => {
    signInAs('user-3');
    mockedLiveStream.mockResolvedValue(liveStream);

    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByText('Идёт звонок · 2 в звонке · 12 слушают')).toBeTruthy();
    expect(screen.getByText('Слушать')).toBeTruthy();

    fireEvent.press(screen.getByTestId('chat-call-bar'));

    await waitFor(() => expect(mockedJoin).toHaveBeenCalled());
    expect(mockedMicrophone).not.toHaveBeenCalled();
  });

  it('нет звонка — нет полосы', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    expect(screen.queryByTestId('chat-call-bar')).toBeNull();
  });

  it('обновляется по событию звонка и исчезает, когда он завершён', async () => {
    mockedLiveStream.mockResolvedValue(liveStream);

    await renderWithQuery(<ChatScreen />);
    await screen.findByTestId('chat-call-bar');

    mockedLiveStream.mockResolvedValue({ ...liveStream, listenersCount: 13 });
    await act(async () => handlers?.onStreamChanged?.());
    expect(await screen.findByText('Идёт звонок · 2 в звонке · 13 слушают')).toBeTruthy();

    mockedLiveStream.mockResolvedValue(null);
    await act(async () => handlers?.onStreamChanged?.());
    await waitFor(() => expect(screen.queryByTestId('chat-call-bar')).toBeNull());
  });

  it('я уже в этом звонке — полоса возвращает на экран звонка', async () => {
    mockedLiveStream.mockResolvedValue(liveStream);
    setCall({
      streamId: 'stream-1',
      chatId: 'chat-1',
      chatTitle: 'Марина',
      role: 'speaker',
      connection: 'connected',
      micOn: true,
      speakerOn: false,
      speakers: [],
      listeners: 0,
      joinedAt: Date.now(),
    });

    await renderWithQuery(<ChatScreen />);

    fireEvent.press(await screen.findByText('Вернуться'));

    expect(mockPush).toHaveBeenCalledWith('/call');
    expect(mockedJoin).not.toHaveBeenCalled();
  });
});

describe('системные сообщения о звонке', () => {
  const call = {
    streamId: 'stream-0',
    hostId: 'user-2',
    startedAt: '2026-10-01T09:00:00Z',
    endedAt: '2026-10-01T09:12:30Z',
  };

  it('рисуются строкой посреди переписки: кто начал и сколько шёл', async () => {
    mockedListMessages.mockResolvedValue({
      items: [
        message({
          id: 's2',
          kind: 'system',
          authorId: null,
          text: 'Звонок завершён · 12 мин',
          call: { ...call, event: 'call_ended', joinedByMe: true },
        }),
        message({
          id: 's1',
          kind: 'system',
          text: 'Звонок начат',
          call: { ...call, event: 'call_started', endedAt: null, joinedByMe: true },
        }),
      ],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByText(/^📞 Звонок начат · Марина/)).toBeTruthy();
    expect(screen.getByText(/^📞 Звонок завершён · 12 мин/)).toBeTruthy();
  });

  it('участник, который так и не вошёл, видит пропущенный звонок', async () => {
    mockedListMessages.mockResolvedValue({
      items: [
        message({
          id: 's2',
          kind: 'system',
          authorId: null,
          text: 'Звонок завершён · 12 мин',
          call: { ...call, event: 'call_ended', joinedByMe: false },
        }),
      ],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByText(/^📞 Пропущенный звонок/)).toBeTruthy();
  });

  it('посетителю звонок не звонил — для него он просто завершён', async () => {
    signInAs('user-3');
    mockedListMessages.mockResolvedValue({
      items: [
        message({
          id: 's2',
          kind: 'system',
          authorId: null,
          text: 'Звонок завершён · 12 мин',
          call: { ...call, event: 'call_ended', joinedByMe: false },
        }),
      ],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByText(/^📞 Звонок завершён · 12 мин/)).toBeTruthy();
  });
});
