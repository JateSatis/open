import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { BackHandler } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import ChatScreen from './[chatId]';

import type { ChatChannelHandlers, ChatSummary, Message } from '@/api/chats';
import {
  deleteMessages,
  getChat,
  listDeletedMessageIds,
  listMessages,
  subscribeToChat,
} from '@/api/chats';
import { listPinnedMessages, pinMessage, type PinnedMessage } from '@/api/pins';
import { confirm } from '@/components/ConfirmDialog';
import { useSession } from '@/features/auth/useSession';
import { resetComposerDrafts } from '@/features/chats/composerDraftStore';
import { resetOutbox } from '@/features/chats/messages/outbox';
import { useInAppAlert } from '@/features/notifications/alertsStore';
import { reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { renderWithQuery } from '@/test/renderWithQuery';

// Шапку экран ставит через Stack.Screen — мок рисует и заголовок, и правую
// кнопку прямо в дереве: так видно «Выбрано: N» и «Отмена».
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ chatId: 'chat-1' }),
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
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
jest.mock('@/api/chats', () => ({
  getChat: jest.fn(),
  listMessages: jest.fn(),
  listMessagesSince: jest.fn(() => Promise.resolve([])),
  markChatRead: jest.fn(() => Promise.resolve()),
  sendMessage: jest.fn(),
  subscribeToChat: jest.fn(),
  deleteMessages: jest.fn(),
  listDeletedMessageIds: jest.fn(),
  MESSAGE_PAGE_SIZE: 30,
}));
jest.mock('@/api/pins', () => ({
  listPinnedMessages: jest.fn(),
  pinMessage: jest.fn(),
  unpinMessage: jest.fn(),
}));
jest.mock('@/api/invites', () => ({
  getMyInvite: jest.fn(() => Promise.resolve(null)),
  acceptInvite: jest.fn(),
  declineInvite: jest.fn(),
}));
jest.mock('@/components/ConfirmDialog', () => ({ confirm: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Medium: 'medium' },
}));
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
const mockedSubscribe = subscribeToChat as jest.MockedFunction<typeof subscribeToChat>;
const mockedDelete = deleteMessages as jest.MockedFunction<typeof deleteMessages>;
const mockedTombstones = listDeletedMessageIds as jest.MockedFunction<
  typeof listDeletedMessageIds
>;
const mockedPins = listPinnedMessages as jest.MockedFunction<typeof listPinnedMessages>;
const mockedPin = pinMessage as jest.MockedFunction<typeof pinMessage>;
const mockedConfirm = confirm as jest.MockedFunction<typeof confirm>;
const mockedSession = useSession as jest.MockedFunction<typeof useSession>;

const AT = '2026-09-27T10:00:00Z';
const member = { id: 'user-1', displayName: 'Я', avatarUrl: null, lastReadAt: AT };
const other = { id: 'user-2', displayName: 'Марина', avatarUrl: null, lastReadAt: AT };

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

function message(id: string, text: string, authorId: string, minute = 0): Message {
  return {
    id,
    chatId: 'chat-1',
    authorId,
    kind: 'text',
    text,
    createdAt: `2026-09-27T10:0${minute}:00Z`,
    attachments: [],
    replies: [],
    forward: null,
  };
}

let handlers: ChatChannelHandlers | null = null;
let backHandler: Parameters<typeof BackHandler.addEventListener>[1] | null = null;

/** Долгое нажатие на сообщение — так, как его видит жест-обработчик. */
async function longPress(messageId: string) {
  await act(async () => {
    fireGestureHandler(getByGestureTestId(`message-long-press-${messageId}`), [
      { state: State.BEGAN, x: 10, y: 10, absoluteX: 20, absoluteY: 200 },
      { state: State.ACTIVE, x: 10, y: 10, absoluteX: 20, absoluteY: 200 },
      { state: State.END, x: 10, y: 10, absoluteX: 20, absoluteY: 200 },
    ]);
  });
}

async function menuItems(): Promise<string[]> {
  await screen.findByTestId('message-menu');

  return screen
    .getAllByRole('menuitem')
    .map((item) => item.props.accessibilityLabel as string);
}

async function choose(label: string) {
  fireEvent.press(await screen.findByRole('menuitem', { name: label }));
  // Действие — следующим кадром после закрытия меню.
  await waitFor(() => expect(screen.queryByTestId('message-menu')).toBeNull());
}

beforeEach(() => {
  jest.clearAllMocks();
  handlers = null;
  backHandler = null;
  resetOutbox();
  resetComposerDrafts();
  resetConnectionState();
  reportRealtimeJoined();
  useInAppAlert.setState({ alert: null });
  mockedSession.mockReturnValue({
    session: { user: { id: 'user-1' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  mockedGetChat.mockResolvedValue(chatWith([member, other]));
  mockedListMessages.mockResolvedValue({
    items: [
      message('m3', 'как дела?', 'user-1', 3),
      message('m2', 'привет', 'user-2', 2),
      message('m1', 'эй', 'user-1', 1),
    ],
    nextCursor: null,
  });
  mockedPins.mockResolvedValue([]);
  mockedTombstones.mockResolvedValue([]);
  mockedConfirm.mockResolvedValue(true);
  mockedSubscribe.mockImplementation((_chatId, given) => {
    handlers = given;
    return { broadcastTyping: jest.fn(), unsubscribe: jest.fn() };
  });
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    backHandler = handler;
    return { remove: () => undefined };
  });
});

describe('message menu', () => {
  it('shows the author every action on their own message', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('как дела?');

    await longPress('m3');

    expect(await menuItems()).toEqual([
      'Ответить',
      'Копировать',
      'Закрепить',
      'Переслать',
      'Выбрать',
      'Удалить',
    ]);
  });

  it('never offers to delete somebody else’s message', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    await longPress('m2');

    expect(await menuItems()).toEqual([
      'Ответить',
      'Копировать',
      'Закрепить',
      'Переслать',
      'Выбрать',
    ]);
  });

  it('lets a visitor copy, forward and select — but not reply', async () => {
    mockedGetChat.mockResolvedValue(
      chatWith([other, { ...member, id: 'user-3', displayName: 'Пётр' }]),
    );

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    await longPress('m2');

    expect(await menuItems()).toEqual(['Копировать', 'Переслать', 'Выбрать']);
  });

  it('closes on a tap outside and on the system back button', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    await longPress('m2');
    fireEvent.press(await screen.findByTestId('message-menu-backdrop'));
    await waitFor(() => expect(screen.queryByTestId('message-menu')).toBeNull());

    await longPress('m2');
    // Системный «назад» у окна Modal приходит как requestClose.
    await act(async () => fireEvent(screen.getByTestId('message-menu'), 'requestClose'));
    await waitFor(() => expect(screen.queryByTestId('message-menu')).toBeNull());
  });

  it('copies the text and says so', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    await longPress('m2');
    await choose('Копировать');

    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('привет'));
    await waitFor(() =>
      expect(useInAppAlert.getState().alert).toMatchObject({ kind: 'notice', text: 'Скопировано' }),
    );
  });

  it('pins through the database and shows the pinned bar', async () => {
    mockedPin.mockResolvedValue(undefined);

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    mockedPins.mockResolvedValue([
      { messageId: 'm2', messageCreatedAt: AT, kind: 'text', text: 'привет', thumbnailUrl: null },
    ]);
    await longPress('m2');
    await choose('Закрепить');

    expect(mockedPin).toHaveBeenCalledWith('m2');
    expect(await screen.findByText('Закреплённое сообщение')).toBeTruthy();
  });
});

describe('deleting', () => {
  it('asks, then removes the message at once', async () => {
    let finish: () => void = () => undefined;
    mockedDelete.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('как дела?');

    await longPress('m3');
    await choose('Удалить');

    expect(mockedConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Удалить сообщение?', message: 'Оно исчезнет у всех.' }),
    );
    // Исчезло до ответа сервера.
    await waitFor(() => expect(screen.queryByText('как дела?')).toBeNull());
    expect(mockedDelete).toHaveBeenCalledWith(['m3']);

    await act(async () => finish());
  });

  it('puts the message back and explains when the server refuses', async () => {
    mockedDelete.mockRejectedValue(new Error('only own messages can be deleted'));

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('как дела?');

    await longPress('m3');
    await choose('Удалить');

    expect(await screen.findByText('как дела?')).toBeTruthy();
    expect(useInAppAlert.getState().alert).toMatchObject({
      kind: 'notice',
      tone: 'error',
      text: 'Не удалось удалить сообщение',
    });
  });

  it('removes what others deleted only after the database confirms it', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    // Событие — только подсказка: база говорит, что удалено лишь m2.
    mockedTombstones.mockResolvedValue(['m2']);
    await act(async () => handlers?.onMessagesDeleted(['m2', 'm3']));

    await waitFor(() => expect(screen.queryByText('привет')).toBeNull());
    expect(screen.getByText('как дела?')).toBeTruthy();
    expect(mockedTombstones).toHaveBeenCalledWith(expect.arrayContaining(['m2', 'm3']));
  });

  it('refreshes the pinned bar when someone pins while the chat is open', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    mockedPins.mockResolvedValue([
      { messageId: 'm1', messageCreatedAt: AT, kind: 'text', text: 'эй', thumbnailUrl: null },
    ]);
    await act(async () => handlers?.onPinsChanged());

    expect(await screen.findByText('Закреплённое сообщение')).toBeTruthy();
  });
});

describe('selection', () => {
  async function startSelecting(messageId: string) {
    longPress(messageId);
    await choose('Выбрать');
    await screen.findByText('Выбрано: 1');
  }

  it('turns the header into a counter and the composer into actions', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    await startSelecting('m3');

    expect(screen.getByText('Отмена')).toBeTruthy();
    expect(screen.getByTestId('selection-action-bar')).toBeTruthy();

    fireEvent.press(screen.getAllByRole('checkbox')[2]);

    expect(await screen.findByText('Выбрано: 2')).toBeTruthy();
  });

  it('leaves selection with «Отмена»', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    await startSelecting('m3');

    fireEvent.press(screen.getByText('Отмена'));

    await waitFor(() => expect(screen.queryByText(/Выбрано/)).toBeNull());
    expect(screen.queryByTestId('selection-action-bar')).toBeNull();
  });

  it('leaves selection with the system back button instead of leaving the chat', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    await startSelecting('m3');

    let handled: boolean | null | undefined;
    await act(async () => {
      handled = backHandler?.({} as Parameters<typeof BackHandler.addEventListener>[1] extends (e: infer E) => unknown ? E : never);
    });

    expect(handled).toBe(true);
    await waitFor(() => expect(screen.queryByText(/Выбрано/)).toBeNull());
  });

  it('leaves selection when the last mark is taken off', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    await startSelecting('m3');

    // Строки новыми вперёд: первый кружок — m3.
    fireEvent.press(screen.getAllByRole('checkbox')[0]);

    await waitFor(() => expect(screen.queryByText(/Выбрано/)).toBeNull());
  });

  it('disables «Удалить» while anything selected is somebody else’s', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    await startSelecting('m3');

    const deleteButton = () => screen.getByRole('button', { name: 'Удалить' });

    expect(deleteButton()).toBeEnabled();

    fireEvent.press(screen.getAllByRole('checkbox')[1]);
    await screen.findByText('Выбрано: 2');

    expect(deleteButton()).toBeDisabled();
  });

  it('copies several messages in chat order with author and time', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    await startSelecting('m3');

    fireEvent.press(screen.getAllByRole('checkbox')[1]);
    await screen.findByText('Выбрано: 2');
    fireEvent.press(screen.getByRole('button', { name: 'Копировать' }));

    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalled());
    const copied = (Clipboard.setStringAsync as jest.Mock).mock.calls[0][0] as string;

    expect(copied.indexOf('привет')).toBeLessThan(copied.indexOf('как дела?'));
    expect(copied).toMatch(/^Марина, \[27\.09\.2026 \d\d:02\]\nпривет\n\nЯ, \[27\.09\.2026 \d\d:03\]\nкак дела\?$/);
    // Скопировал — выбор больше не нужен.
    await waitFor(() => expect(screen.queryByText(/Выбрано/)).toBeNull());
  });

  it('deletes several own messages with one question', async () => {
    mockedDelete.mockResolvedValue(undefined);

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    await startSelecting('m3');

    fireEvent.press(screen.getAllByRole('checkbox')[2]);
    await screen.findByText('Выбрано: 2');
    fireEvent.press(screen.getByRole('button', { name: 'Удалить' }));

    await waitFor(() =>
      expect(mockedConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Удалить 2 сообщения?', message: 'Они исчезнут у всех.' }),
      ),
    );
    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith(['m1', 'm3']));
    await waitFor(() => expect(screen.queryByText('эй')).toBeNull());
  });

  it('keeps the selection when a new message arrives', async () => {
    const { listMessagesSince } = jest.requireMock('@/api/chats') as {
      listMessagesSince: jest.Mock;
    };

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    await startSelecting('m3');

    listMessagesSince.mockResolvedValue([message('m4', 'новое', 'user-2', 4)]);
    await act(async () => handlers?.onMessage());

    expect(await screen.findByText('новое')).toBeTruthy();
    expect(screen.getByText('Выбрано: 1')).toBeTruthy();
  });
});

describe('pinned bar', () => {
  const pins: PinnedMessage[] = [
    { messageId: 'm1', messageCreatedAt: '2026-09-27T10:01:00Z', kind: 'text', text: 'эй', thumbnailUrl: null },
    { messageId: 'm2', messageCreatedAt: '2026-09-27T10:02:00Z', kind: 'voice', text: null, thumbnailUrl: null },
  ];

  it('shows the newest pin with its number and steps back on each tap', async () => {
    mockedPins.mockResolvedValue(pins);

    await renderWithQuery(<ChatScreen />);

    expect(await screen.findByText('Закреплённое сообщение 2 из 2')).toBeTruthy();
    expect(screen.getByText('🎤 Голосовое')).toBeTruthy();

    fireEvent.press(screen.getByTestId('pinned-bar'));

    expect(await screen.findByText('Закреплённое сообщение 1 из 2')).toBeTruthy();
  });

  it('loads older pages until the pinned message is there', async () => {
    mockedPins.mockResolvedValue([
      { messageId: 'm0', messageCreatedAt: '2026-09-27T09:00:00Z', kind: 'text', text: 'давнее', thumbnailUrl: null },
    ]);
    mockedListMessages
      .mockResolvedValueOnce({ items: [message('m3', 'как дела?', 'user-1', 3)], nextCursor: '2026-09-27T10:03:00Z' })
      .mockResolvedValueOnce({ items: [message('m2', 'привет', 'user-2', 2)], nextCursor: '2026-09-27T10:02:00Z' })
      .mockResolvedValueOnce({
        items: [{ ...message('m0', 'давнее', 'user-2'), createdAt: '2026-09-27T09:00:00Z' }],
        nextCursor: null,
      });

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('как дела?');

    fireEvent.press(await screen.findByTestId('pinned-bar'));

    // Полоса тоже показывает «давнее» — ищем именно в переписке.
    await waitFor(() => expect(screen.getAllByText('давнее')).toHaveLength(2));
    expect(mockedListMessages).toHaveBeenCalledTimes(3);
    expect(mockedListMessages).toHaveBeenLastCalledWith('chat-1', {
      cursor: '2026-09-27T10:02:00Z',
    });
  });
});
