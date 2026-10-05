import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { act, fireEvent, screen, userEvent, waitFor, within } from '@testing-library/react-native';

import ChatScreen from './[chatId]';

import type {
  ChatChannelHandlers,
  ChatSummary,
  Message,
  MessageAttachment,
  QuotedMessage,
} from '@/api/chats';
import {
  editMessage,
  getChat,
  listDeletedMessageIds,
  listMessageEdits,
  listMessages,
  listMessagesByIds,
  sendMessage,
  sendVoiceMessage,
  subscribeToChat,
} from '@/api/chats';
import { listPinnedMessages } from '@/api/pins';
import { confirm } from '@/components/ConfirmDialog';
import { useSession } from '@/features/auth/useSession';
import { readChatDraft, resetComposerDrafts } from '@/features/chats/composerDraftStore';
import { resetOutbox } from '@/features/chats/messages/outbox';
import { resetPendingEdits } from '@/features/chats/messages/pendingEdits';
import { reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { useInAppAlert } from '@/features/notifications/alertsStore';
import { island, original } from '@/test/islands';
import { renderWithQuery } from '@/test/renderWithQuery';

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
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
  Stack: { Screen: () => null },
}));

jest.mock('@/api/profile', () => ({ getProfile: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@/features/auth/useSession', () => ({ useSession: jest.fn() }));
jest.mock('@/api/streams');

jest.mock('@/api/chats', () => ({
  // Островок из другого чата слушает топик того чата — здесь без сети.
  subscribeToChatSignals: jest.fn(() => () => undefined),
  getChatReadUpTo: jest.fn(() => Promise.resolve(null)),
  getChat: jest.fn(),
  listMessages: jest.fn(),
  listMessagesSince: jest.fn(() => Promise.resolve([])),
  markChatRead: jest.fn(() => Promise.resolve()),
  sendMessage: jest.fn(),
  sendVoiceMessage: jest.fn(),
  forwardMessages: jest.fn(),
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
  listComments: jest.fn(() => Promise.resolve({ items: [], nextCursor: null })),
  getCommentTarget: jest.fn(() => Promise.resolve({ state: 'missing' })),
  subscribeToComments: jest.fn(() => () => undefined),
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
  ImpactFeedbackStyle: { Medium: 'medium', Light: 'light' },
}));
jest.mock('@/features/media', () => ({
  ...jest.requireActual('@/features/media/selectionStore'),
  assetPreviewUri: (asset: { id: string }) => asset.id,
  MediaGrid: () => null,
  MediaViewer: () => null,
  VoicePlayer: () => null,
  stopVoice: jest.fn(),
}));
// Жест записи здесь не проверяется — только то, куда уходит готовая запись.
// Кнопка «записать» сразу отдаёт голосовое, как отпущенное удержание.
jest.mock('@/features/media/HoldToRecordRow', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  const { createElement, Fragment } = jest.requireActual('react');

  return {
    HoldToRecordRow: ({
      children,
      onSend,
      recordDisabled,
    }: {
      children: unknown;
      onSend: (voice: unknown) => void;
      recordDisabled?: boolean;
    }) =>
      createElement(
        Fragment,
        null,
        children,
        createElement(
          Pressable,
          {
            accessibilityRole: 'button',
            accessibilityLabel: 'Записать голосовое',
            disabled: recordDisabled,
            accessibilityState: { disabled: Boolean(recordDisabled) },
            onPress: () =>
              onSend({
                kind: 'voice',
                uri: 'file:///cache/new.m4a',
                mimeType: 'audio/mp4',
                width: null,
                height: null,
                durationMs: 3000,
                waveform: [1, 2, 3],
              }),
          },
          createElement(Text, null, 'Г'),
        ),
      ),
  };
});
jest.mock('@/features/media/galleryPrefetch', () => ({ prefetchGallery: jest.fn() }));

const mockedGetChat = getChat as jest.MockedFunction<typeof getChat>;
const mockedListMessages = listMessages as jest.MockedFunction<typeof listMessages>;
const mockedSend = sendMessage as jest.MockedFunction<typeof sendMessage>;
const mockedSendVoice = sendVoiceMessage as jest.MockedFunction<typeof sendVoiceMessage>;
const mockedEdit = editMessage as jest.MockedFunction<typeof editMessage>;
const mockedByIds = listMessagesByIds as jest.MockedFunction<typeof listMessagesByIds>;
const mockedEdits = listMessageEdits as jest.MockedFunction<typeof listMessageEdits>;
const mockedSubscribe = subscribeToChat as jest.MockedFunction<typeof subscribeToChat>;
const mockedTombstones = listDeletedMessageIds as jest.MockedFunction<typeof listDeletedMessageIds>;
const mockedPins = listPinnedMessages as jest.MockedFunction<typeof listPinnedMessages>;
const mockedSession = useSession as jest.MockedFunction<typeof useSession>;
const mockedConfirm = confirm as jest.MockedFunction<typeof confirm>;

const AT = '2026-09-29T10:00:00Z';
const member = { id: 'user-1', displayName: 'Я', avatarUrl: null, lastReadAt: AT };
const other = { id: 'user-2', displayName: 'Марина', avatarUrl: null, lastReadAt: AT };
const stranger = { id: 'user-3', displayName: 'Пётр', avatarUrl: null, lastReadAt: AT };

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

function message(id: string, text: string | null, authorId: string, minute = 0): Message {
  return {
    id,
    chatId: 'chat-1',
    authorId,
    kind: 'text',
    text,
    createdAt: `2026-09-29T10:0${minute}:00Z`,
    editedAt: null,
    attachments: [],
    replies: [],
    forward: null,
    reactions: { members: {}, visitors: {}, mine: null },
    commentsCount: 0,
    viewsCount: 0,
    readAt: null,
  };
}

function photo(id: string): MessageAttachment {
  return {
    id,
    url: `https://cdn.example/${id}.jpg`,
    posterUrl: null,
    mimeType: 'image/jpeg',
    width: 100,
    height: 100,
    durationMs: null,
    waveform: null,
  };
}

const voiceFile: MessageAttachment = {
  id: 'v-att',
  url: 'https://cdn.example/v.m4a',
  posterUrl: null,
  mimeType: 'audio/mp4',
  width: null,
  height: null,
  durationMs: 2000,
  waveform: [3, 2, 1],
};

let channel: ChatChannelHandlers | null = null;

/** Тап по облачку — так открывается его меню. */
async function tapMessage(messageId: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(`message-row-${messageId}`));
  });
}

async function choose(label: string) {
  fireEvent.press(await screen.findByRole('menuitem', { name: label }));
  await waitFor(() => expect(screen.queryByTestId('message-menu')).toBeNull());
}

async function startEditing(messageId: string) {
  await tapMessage(messageId);
  await choose('Изменить');
  await screen.findByText('Редактирование');
}

function field() {
  return screen.getByLabelText('Сообщение');
}

beforeEach(() => {
  jest.clearAllMocks();
  resetOutbox();
  resetPendingEdits();
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
    items: [message('m2', 'привет', 'user-2', 2), message('m1', 'эй', 'user-1', 1)],
    nextCursor: null,
  });
  mockedPins.mockResolvedValue([]);
  mockedTombstones.mockResolvedValue([]);
  mockedEdits.mockResolvedValue([]);
  mockedByIds.mockResolvedValue([]);
  mockedSubscribe.mockImplementation((_chatId, handlers) => {
    channel = handlers;
    return { broadcastTyping: jest.fn(), unsubscribe: jest.fn() };
  });
});

afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});

describe('who can edit', () => {
  it('offers «Изменить» on my own message', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    await tapMessage('m1');
    expect(await screen.findByRole('menuitem', { name: 'Изменить' })).toBeTruthy();
  });

  it('never offers it on somebody else’s message', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    await tapMessage('m2');
    await screen.findByTestId('message-menu');
    expect(screen.queryByRole('menuitem', { name: 'Изменить' })).toBeNull();
  });

  it('never offers it on an original shown in a forward island — even my own', async () => {
    // Своё сообщение, пересланное сюда из другого чата: правят его там, где оно живёт.
    mockedListMessages.mockResolvedValue({
      items: [
        island('f1', '2026-09-16T10:03:00Z', [
          original({ id: 'o1', text: 'мои слова', authorId: 'user-1', authorName: 'Я' }),
        ]),
      ],
      nextCursor: null,
    });

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('мои слова');

    await tapMessage('f1/o1');
    await screen.findByTestId('message-menu');
    expect(screen.queryByRole('menuitem', { name: 'Изменить' })).toBeNull();
  });

  it('gives a visitor no «Изменить» even on what used to be their message', async () => {
    // Автор вышел из чата: писать в него, в том числе правкой, он больше не может.
    mockedGetChat.mockResolvedValue(chatWith([other, stranger]));

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('эй');

    await tapMessage('m1');
    await screen.findByTestId('message-menu');
    expect(screen.queryByRole('menuitem', { name: 'Изменить' })).toBeNull();
  });
});

describe('editing text', () => {
  it('puts the text into the field under an «Редактирование» plate', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    await startEditing('m1');

    const plate = screen.getByTestId('composer-plate');

    expect(within(plate).getByText('эй')).toBeTruthy();
    expect(field().props.value).toBe('эй');
    expect(screen.getByLabelText('Сохранить')).toBeEnabled();
  });

  it('saves instead of sending: the bubble shows the new text with «изменено» at once', async () => {
    mockedEdit.mockReturnValue(new Promise(() => undefined));

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    await startEditing('m1');

    const user = userEvent.setup();

    await user.type(field(), ', как ты?');
    await user.press(screen.getByLabelText('Сохранить'));

    expect(await screen.findByText('эй, как ты?')).toBeTruthy();
    expect(screen.getByText('изменено · Сохраняется…')).toBeTruthy();
    expect(mockedEdit).toHaveBeenCalledWith('m1', { text: 'эй, как ты?', media: [], voice: null });
    expect(mockedSend).not.toHaveBeenCalled();
    // Правка закончилась — поле пустое, плашки нет.
    await waitFor(() => expect(screen.queryByTestId('composer-plate')).toBeNull());
    expect(field().props.value).toBe('');
  });

  it('shows the confirmed version with «изменено» next to the time', async () => {
    mockedEdit.mockResolvedValue({ ...message('m1', 'эй, всё', 'user-1', 1), editedAt: AT });

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    await startEditing('m1');

    const user = userEvent.setup();

    await user.clear(field());
    await user.type(field(), 'эй, всё');
    await user.press(screen.getByLabelText('Сохранить'));

    expect(await screen.findByText('изменено')).toBeTruthy();
    expect(screen.getByText('эй, всё')).toBeTruthy();
  });

  it('just leaves the edit when nothing changed', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    await startEditing('m1');

    fireEvent.press(screen.getByLabelText('Сохранить'));

    await waitFor(() => expect(screen.queryByTestId('composer-plate')).toBeNull());
    expect(mockedEdit).not.toHaveBeenCalled();
    expect(mockedConfirm).not.toHaveBeenCalled();
  });

  it('cannot save an empty message', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    await startEditing('m1');

    await userEvent.setup().clear(field());

    expect(screen.getByLabelText('Сохранить')).toBeDisabled();
  });

  it('puts the old version back and explains when the server refuses', async () => {
    mockedEdit.mockRejectedValue({ code: 'P0002', message: 'message not found' });

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    await startEditing('m1');

    const user = userEvent.setup();

    await user.type(field(), '!!!');
    await user.press(screen.getByLabelText('Сохранить'));

    await waitFor(() =>
      expect(useInAppAlert.getState().alert).toMatchObject({
        text: 'Не удалось изменить: сообщение удалено',
      }),
    );
    expect(screen.getByText('эй')).toBeTruthy();
    expect(screen.queryByText('эй!!!')).toBeNull();
    expect(screen.queryByText('изменено')).toBeNull();
  });
});

describe('leaving an edit', () => {
  it('asks before dropping changes and brings back the reply draft that was there', async () => {
    mockedConfirm.mockResolvedValue(true);

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    const user = userEvent.setup();

    await tapMessage('m2');
    await choose('Ответить');
    await user.type(field(), 'черновик');

    await startEditing('m1');
    expect(screen.queryByText('В ответ Марина')).toBeNull();
    await user.type(field(), ' правка');

    fireEvent.press(screen.getByRole('button', { name: 'Отменить редактирование' }));

    await waitFor(() => expect(screen.getByText('В ответ Марина')).toBeTruthy());
    expect(mockedConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Отменить изменения?' }),
    );
    expect(field().props.value).toBe('черновик');
    expect(mockedEdit).not.toHaveBeenCalled();
    expect(screen.getByText('эй')).toBeTruthy();
  });

  it('stays in the edit when the person changes their mind', async () => {
    mockedConfirm.mockResolvedValue(false);

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    await startEditing('m1');
    await userEvent.setup().type(field(), ' правка');

    fireEvent.press(screen.getByRole('button', { name: 'Отменить редактирование' }));

    await waitFor(() => expect(mockedConfirm).toHaveBeenCalled());
    expect(screen.getByText('Редактирование')).toBeTruthy();
    expect(field().props.value).toBe('эй правка');
  });

  it('leaves without a question when nothing changed', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    await userEvent.setup().type(field(), 'было в поле');
    await startEditing('m1');

    fireEvent.press(screen.getByRole('button', { name: 'Отменить редактирование' }));

    await waitFor(() => expect(screen.queryByText('Редактирование')).toBeNull());
    expect(mockedConfirm).not.toHaveBeenCalled();
    expect(field().props.value).toBe('было в поле');
  });

  it('does not keep a half-made edit in the chat draft after leaving the chat', async () => {
    const view = await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');
    await userEvent.setup().type(field(), 'моё');
    await startEditing('m1');

    await view.unmount();

    expect(readChatDraft('chat-1')).toEqual({ text: 'моё', mode: null });
  });
});

describe('editing an album', () => {
  beforeEach(() => {
    mockedListMessages.mockResolvedValue({
      items: [
        {
          ...message('a1', 'подпись', 'user-1', 3),
          kind: 'media',
          attachments: [photo('p1'), photo('p2')],
        },
      ],
      nextCursor: null,
    });
  });

  it('lists the files under the plate and saves without the one taken out', async () => {
    mockedEdit.mockReturnValue(new Promise(() => undefined));

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('подпись');
    await startEditing('a1');

    expect(screen.getAllByTestId('edit-attachment')).toHaveLength(2);
    // Голосовое к альбому не добавить: итог нарушил бы инвариант.
    expect(screen.getByLabelText('Записать голосовое')).toBeDisabled();

    fireEvent.press(screen.getAllByRole('button', { name: 'Убрать фото' })[0]);

    await waitFor(() => expect(screen.getAllByTestId('edit-attachment')).toHaveLength(1));
    fireEvent.press(screen.getByLabelText('Сохранить'));

    await waitFor(() =>
      expect(mockedEdit).toHaveBeenCalledWith('a1', {
        text: 'подпись',
        media: [{ attachmentId: 'p2' }],
        voice: null,
      }),
    );
  });

  it('turns into text when every file is taken out and the caption stays', async () => {
    mockedEdit.mockReturnValue(new Promise(() => undefined));

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('подпись');
    await startEditing('a1');

    fireEvent.press(screen.getAllByRole('button', { name: 'Убрать фото' })[0]);
    await waitFor(() => expect(screen.getAllByTestId('edit-attachment')).toHaveLength(1));
    fireEvent.press(screen.getByRole('button', { name: 'Убрать фото' }));
    await waitFor(() => expect(screen.queryByTestId('edit-attachment')).toBeNull());

    fireEvent.press(screen.getByLabelText('Сохранить'));

    await waitFor(() =>
      expect(mockedEdit).toHaveBeenCalledWith('a1', { text: 'подпись', media: [], voice: null }),
    );
  });
});

describe('editing a voice message', () => {
  beforeEach(() => {
    mockedListMessages.mockResolvedValue({
      items: [
        { ...message('v1', null, 'user-1', 3), kind: 'voice', attachments: [voiceFile] },
      ],
      nextCursor: null,
    });
  });

  it('keeps the recording in a chip: no caption, no media, no second recording', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByTestId('message-bubble');
    await startEditing('v1');

    expect(screen.getByTestId('edit-voice-chip')).toBeTruthy();
    expect(within(screen.getByTestId('composer-plate')).getByText('Голосовое')).toBeTruthy();
    expect(field().props.editable).toBe(false);
    expect(screen.getByRole('button', { name: 'Фото и видео' })).toBeDisabled();
    expect(screen.getByLabelText('Записать голосовое')).toBeDisabled();
  });

  it('becomes text once the recording is taken out', async () => {
    mockedEdit.mockReturnValue(new Promise(() => undefined));

    await renderWithQuery(<ChatScreen />);
    await screen.findByTestId('message-bubble');
    await startEditing('v1');

    fireEvent.press(screen.getByRole('button', { name: 'Убрать голосовое' }));

    await waitFor(() => expect(field().props.editable).toBe(true));
    expect(screen.queryByTestId('edit-voice-chip')).toBeNull();
    expect(screen.getByLabelText('Сохранить')).toBeDisabled();
    expect(screen.getByLabelText('Записать голосовое')).toBeEnabled();

    const user = userEvent.setup();

    await user.type(field(), 'расшифровка');
    // Текст есть — голосовое к нему уже не записать.
    expect(screen.getByLabelText('Записать голосовое')).toBeDisabled();
    await user.press(screen.getByLabelText('Сохранить'));

    await waitFor(() =>
      expect(mockedEdit).toHaveBeenCalledWith('v1', { text: 'расшифровка', media: [], voice: null }),
    );
  });

  it('puts a new recording into the chip instead of sending it', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByTestId('message-bubble');
    await startEditing('v1');

    fireEvent.press(screen.getByRole('button', { name: 'Убрать голосовое' }));
    await waitFor(() => expect(screen.getByLabelText('Записать голосовое')).toBeEnabled());
    fireEvent.press(screen.getByLabelText('Записать голосовое'));

    expect(await screen.findByTestId('edit-voice-chip')).toBeTruthy();
    expect(mockedSendVoice).not.toHaveBeenCalled();
    expect(readChatDraft('chat-1').mode).toMatchObject({
      type: 'edit',
      voice: { type: 'new', voice: { uri: 'file:///cache/new.m4a' } },
    });
  });
});

describe('edits by others', () => {
  const quote: QuotedMessage = {
    messageId: 'm2',
    state: 'live',
    authorId: 'user-2',
    authorName: 'Марина',
    createdAt: '2026-09-29T10:02:00Z',
    editedAt: null,
    preview: {
      kind: 'text',
      text: 'привет',
      thumbnailUrl: null,
      mediaCount: 0,
      firstMediaIsVideo: false,
      durationMs: null,
    },
  };

  it('updates the bubble and its quotes in place, re-reading the row from the database', async () => {
    mockedListMessages.mockResolvedValue({
      items: [
        { ...message('r1', 'отвечаю', 'user-1', 3), replies: [quote] },
        message('m2', 'привет', 'user-2', 2),
      ],
      nextCursor: null,
    });
    mockedByIds.mockResolvedValue([
      { ...message('m2', 'привет, исправила', 'user-2', 2), editedAt: AT },
    ]);

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('отвечаю');

    await act(async () => channel?.onMessageEdited('m2'));

    await waitFor(() => expect(screen.getAllByText('привет, исправила')).toHaveLength(2));
    expect(mockedByIds).toHaveBeenCalledWith(['m2']);
    expect(screen.getByText('изменено')).toBeTruthy();
  });

  it('catches up on edits it missed while the channel was gone', async () => {
    mockedEdits.mockResolvedValue([{ id: 'm2', editedAt: AT }]);
    mockedByIds.mockResolvedValue([
      { ...message('m2', 'поправила, пока тебя не было', 'user-2', 2), editedAt: AT },
    ]);

    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    await act(async () => channel?.onReconnected?.());

    expect(await screen.findByText('поправила, пока тебя не было')).toBeTruthy();
    expect(mockedByIds).toHaveBeenCalledWith(['m2']);
  });

  it('ignores an edit signal for something not on screen', async () => {
    await renderWithQuery(<ChatScreen />);
    await screen.findByText('привет');

    await act(async () => channel?.onMessageEdited('elsewhere'));

    expect(mockedByIds).not.toHaveBeenCalled();
  });
});
