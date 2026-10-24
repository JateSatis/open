import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { SavedScreen } from './index';

import {
  deleteSavedNoteByClient,
  editSavedNote,
  getSavedMessage,
  listSavedMessages,
  listSavedPins,
  listSavedTags,
  listWatchLater,
  sendSavedNote,
  type SavedMessage,
} from '@/api/saved';
import { confirm } from '@/components/ConfirmDialog/store';
import { useSession } from '@/features/auth/useSession';
import { resetComposerDrafts } from '@/features/chats/composerDraftStore';
import { resetNotesOutbox, useNotesOutbox } from '@/features/saved/notesStore';
import { longPressMessage } from '@/test/messageGestures';
import { renderWithQuery } from '@/test/renderWithQuery';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useNavigation: () => ({ setOptions: jest.fn() }),
  useIsFocused: () => true,
}));
jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('@/features/profile/queries', () => ({
  useMyProfile: () => ({ data: { displayName: 'Я', avatarUrl: null } }),
}));
jest.mock('@/features/media', () => ({
  ...jest.requireActual('@/test/outgoingMediaMock').outgoingMediaMock,
  ...jest.requireActual('@/features/media/selectionStore'),
  MediaViewer: () => null,
  MediaGrid: () => null,
  VoicePlayer: () => null,
  stopVoice: jest.fn(),
}));
jest.mock('@/features/media/HoldToRecordRow', () => ({
  // Строка ввода как есть; справа — «Отправить», когда она стоит на месте микрофона.
  HoldToRecordRow: ({ children, trailing }: { children: unknown; trailing?: unknown }) =>
    jest
      .requireActual('react')
      .createElement(jest.requireActual('react').Fragment, null, children, trailing),
}));
jest.mock('@/features/media/galleryPrefetch', () => ({ prefetchGallery: jest.fn() }));
jest.mock('@/features/auth/useSession', () => ({ useSession: jest.fn() }));
jest.mock('@/components/ConfirmDialog/store', () => ({ confirm: jest.fn() }));
jest.mock('@/api/saved', () => ({
  listSavedMessages: jest.fn(),
  listSavedAround: jest.fn(),
  listWatchLater: jest.fn(),
  listSavedPins: jest.fn(),
  listSavedForwardable: jest.fn(),
  fetchSourceChats: jest.fn(() => Promise.resolve(new Map())),
  listSavedTags: jest.fn(),
  getSavedSource: jest.fn(),
  getSavedSummary: jest.fn(() => Promise.resolve({ watchLaterPending: 0 })),
  sendSavedNote: jest.fn(),
  getSavedMessage: jest.fn(),
  deleteSavedNoteByClient: jest.fn(() => Promise.resolve()),
  editSavedNote: jest.fn(() => Promise.resolve()),
  deleteSavedMessages: jest.fn(() => Promise.resolve()),
}));

const mocked = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as jest.Mock;

function saved(id: string, seq: number, overrides: Partial<SavedMessage> = {}): SavedMessage {
  return {
    id,
    seq,
    savedAt: '2026-10-20T10:00:00Z',
    sourceType: 'message',
    category: 'member',
    sourceChatId: 'chat-g',
    sourceMessageId: `msg-${id}`,
    sourceCommentId: null,
    sourceSeq: 42,
    commentMessageId: null,
    commentPopId: null,
    kind: 'text',
    text: `текст ${id}`,
    authorId: 'user-anna',
    authorName: 'Анна',
    authorAvatarUrl: null,
    authorOpaque: false,
    originalAt: '2026-10-19T08:30:00Z',
    watchLaterAt: null,
    watchDoneAt: null,
    pinnedAt: null,
    attachments: [],
    tagIds: [],
    edited: false,
    replies: [],
    ...overrides,
  };
}

function note(id: string, seq: number, overrides: Partial<SavedMessage> = {}): SavedMessage {
  return saved(id, seq, {
    sourceType: 'note',
    category: 'note',
    sourceChatId: null,
    sourceMessageId: null,
    sourceSeq: null,
    authorId: 'user-1',
    authorName: 'Я',
    text: `заметка ${id}`,
    ...overrides,
  });
}

async function renderScreen(items: SavedMessage[]) {
  mocked(listSavedMessages).mockResolvedValue({ items, nextCursor: null, prevCursor: null });
  await renderWithQuery(<SavedScreen />);
  await screen.findByTestId(items.length > 0 ? 'saved-list' : 'saved-empty');
}

const field = () => screen.getByLabelText('Заметка');
const pendingId = () => useNotesOutbox.getState().items[0]?.localId ?? '';

beforeEach(() => {
  jest.clearAllMocks();
  resetComposerDrafts();
  resetNotesOutbox();
  (useSession as jest.Mock).mockReturnValue({
    session: { user: { id: 'user-1' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  mocked(listSavedTags).mockResolvedValue([]);
  mocked(listSavedPins).mockResolvedValue([]);
  mocked(listWatchLater).mockResolvedValue({ items: [], nextCursor: null });
});

describe('SavedScreen — заметки', () => {
  it('shows the note field even when nothing is saved, without hints about who sees it', async () => {
    await renderScreen([]);

    expect(field()).toBeTruthy();
    fireEvent.changeText(field(), 'мой телефон +7 999 123-45-67');
    expect(screen.queryByText(/увидят/)).toBeNull();
    expect(screen.queryByLabelText('Скрыть от зрителей')).toBeNull();
  });

  it('a sent note appears at once with a clock, then as confirmed; one call with a retry key', async () => {
    let answer: (value: string) => void = () => undefined;
    mocked(sendSavedNote).mockReturnValue(new Promise((resolve) => (answer = resolve)));
    mocked(getSavedMessage).mockResolvedValue(note('n1', 2, { text: 'купить хлеб' }));
    await renderScreen([saved('a', 1)]);

    fireEvent.changeText(field(), '  купить хлеб ');
    fireEvent.press(await screen.findByTestId('composer-send'));

    const row = await screen.findByText('купить хлеб');
    expect(within(screen.getByTestId('saved-list')).getAllByText('Вы').length).toBe(1);
    expect(screen.getByLabelText('Отправляется')).toBeTruthy();
    expect(field().props.value).toBe('');
    expect(sendSavedNote).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'купить хлеб', files: [], replyTo: [], kind: 'post' }),
    );
    expect(mocked(sendSavedNote).mock.calls[0][0].clientId).toEqual(expect.any(String));

    await act(async () => answer('n1'));

    await waitFor(() => expect(screen.queryByLabelText('Отправляется')).toBeNull());
    expect(row).toBeTruthy();
  });

  it('a failed note offers «Повторить» with the same key, and goes once', async () => {
    mocked(sendSavedNote)
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce('n1');
    mocked(getSavedMessage).mockResolvedValue(note('n1', 2, { text: 'офлайн' }));
    await renderScreen([saved('a', 1)]);

    fireEvent.changeText(field(), 'офлайн');
    fireEvent.press(await screen.findByTestId('composer-send'));
    fireEvent.press(await screen.findByLabelText('Не отправлено. Повторить'));

    await waitFor(() => expect(screen.queryByLabelText('Не отправлено. Повторить')).toBeNull());
    expect(sendSavedNote).toHaveBeenCalledTimes(2);
    const [first, second] = mocked(sendSavedNote).mock.calls;
    expect(second[0].clientId).toBe(first[0].clientId);
  });

  it('«Ответить» puts a plate over the field and the note goes with the quote', async () => {
    mocked(sendSavedNote).mockResolvedValue('n1');
    mocked(getSavedMessage).mockResolvedValue(note('n1', 3));
    await renderScreen([saved('a', 1)]);

    await longPressMessage('a');
    fireEvent.press(await screen.findByLabelText('Ответить'));

    expect(await screen.findByLabelText('Отменить ответ')).toBeTruthy();
    fireEvent.changeText(field(), 'ответ');
    fireEvent.press(await screen.findByTestId('composer-send'));

    await waitFor(() =>
      expect(sendSavedNote).toHaveBeenCalledWith(expect.objectContaining({ replyTo: ['a'] })),
    );
    expect(screen.queryByLabelText('Отменить ответ')).toBeNull();
  });

  it('a deleted quote is a stub «Запись удалена»', async () => {
    await renderScreen([note('n1', 2, { replies: [{ savedId: null }] })]);

    expect(screen.getByText('Запись удалена')).toBeTruthy();
  });

  it('a saved copy has no «Изменить»', async () => {
    await renderScreen([saved('a', 1)]);

    await longPressMessage('a');
    expect(await screen.findByLabelText('Ответить')).toBeTruthy();
    expect(screen.queryByLabelText('Изменить')).toBeNull();
  });

  it('«Изменить» own note: text in the field, saved with «ред.»', async () => {
    await renderScreen([note('n1', 2)]);

    await longPressMessage('n1');
    fireEvent.press(await screen.findByLabelText('Изменить'));

    await waitFor(() => expect(field().props.value).toBe('заметка n1'));
    fireEvent.changeText(field(), 'исправлено');
    fireEvent.press(await screen.findByTestId('composer-send'));

    expect(await screen.findByText('исправлено')).toBeTruthy();
    expect(editSavedNote).toHaveBeenCalledWith('n1', 'исправлено', []);
    expect(screen.getByText('ред.')).toBeTruthy();
  });

  it('deleting a note asks «Удалить заметку?» without the phrase about the original', async () => {
    mocked(confirm).mockResolvedValue(false);
    await renderScreen([note('n1', 2)]);

    await longPressMessage('n1');
    fireEvent.press(await screen.findByLabelText('Удалить'));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(mocked(confirm).mock.calls[0][0]).toMatchObject({ title: 'Удалить заметку?' });
    expect(mocked(confirm).mock.calls[0][0].message).toBeUndefined();
  });

  it('a note whose quoted record is deleted shows «Запись удалена» right away', async () => {
    mocked(confirm).mockResolvedValue(true);
    await renderScreen([
      saved('a', 1),
      note('n1', 2, {
        replies: [
          {
            savedId: 'a',
            seq: 1,
            sourceType: 'message',
            sourceChatId: 'chat-g',
            category: 'member',
            kind: 'text',
            text: 'текст a',
            attachments: [],
          },
        ],
      }),
    ]);

    await longPressMessage('a');
    fireEvent.press(await screen.findByLabelText('Удалить'));

    expect(await screen.findByText('Запись удалена')).toBeTruthy();
  });

  it('a failed note removed before the server answered is deleted there by its key', async () => {
    mocked(sendSavedNote).mockRejectedValue(new TypeError('Network request failed'));
    await renderScreen([saved('a', 1)]);

    fireEvent.changeText(field(), 'потеряна');
    fireEvent.press(await screen.findByTestId('composer-send'));
    await screen.findByLabelText('Не отправлено. Повторить');

    expect(screen.getByText('потеряна')).toBeTruthy();
    await longPressMessage(pendingId());
    fireEvent.press(await screen.findByLabelText('Удалить'));

    await waitFor(() => expect(screen.queryByText('потеряна')).toBeNull());
    expect(deleteSavedNoteByClient).toHaveBeenCalledWith(
      mocked(sendSavedNote).mock.calls[0][0].clientId,
    );
  });
});
