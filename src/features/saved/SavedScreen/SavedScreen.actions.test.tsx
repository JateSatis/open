import { requestClient } from '@/api/requestClient';
import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { SavedScreen } from './index';

import { listForwardedComments, listIslandOriginals } from '@/api/messageRows';
import { deleteSavedMessages, listSavedForwardable, listSavedMessages, listSavedPins, listSavedTags, listWatchLater, restoreSavedWatchLater, setSavedPinned, setSavedTag, setSavedWatchLater, type SavedMessage } from '@/api/saved';
import { confirm } from '@/components/ConfirmDialog/store';
import { useSession } from '@/features/auth/useSession';
import { readForwardPick, resetComposerDrafts } from '@/features/chats/composerDraftStore';
import { useInAppAlert } from '@/features/notifications/alertsStore';
import { original } from '@/test/islands';
import { longPressMessage } from '@/test/messageGestures';
import { renderWithQuery } from '@/test/renderWithQuery';

const mockPush = jest.fn();
const mockSetOptions = jest.fn();

jest.mock('@/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useNavigation: () => ({ setOptions: mockSetOptions }),
  useIsFocused: () => true,
  // Шапка экрана — кнопки поиска и фильтров справа.
  ScreenOptions: ({ options }: { options?: { headerRight?: () => unknown } }) =>
      options?.headerRight ? options.headerRight() : null,
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('@/api/supabase', () => ({ supabase: {} }));
// Поле заметок — своими тестами (SavedScreen.notes.test.tsx).
jest.mock('@/features/saved/SavedComposer', () => ({ SavedComposer: () => null }));
jest.mock('@/features/profile/queries', () => ({ useMyProfile: () => ({ data: undefined }) }));
jest.mock('@/features/media', () => ({
  ...jest.requireActual('@/features/media/selectionStore'),
  MediaViewer: () => null,
  VoicePlayer: () => null,
}));
jest.mock('@/features/auth/useSession', () => ({ useSession: jest.fn() }));
jest.mock('@/components/ConfirmDialog/store', () => ({ confirm: jest.fn() }));
jest.mock('@/api/messageRows', () => ({
  ...jest.requireActual('@/api/messageRows'),
  listIslandOriginals: jest.fn(),
  listForwardedComments: jest.fn(),
}));
jest.mock('@/api/saved', () => ({
  listSavedMessages: jest.fn(),
  listWatchLater: jest.fn(),
  listSavedPins: jest.fn(),
  listSavedForwardable: jest.fn(),
  fetchSourceChats: jest.fn(() => Promise.resolve(new Map())),
  listSavedTags: jest.fn(),
  getSavedSummary: jest.fn(() => Promise.resolve({ watchLaterPending: 0 })),
  setSavedTag: jest.fn(() => Promise.resolve()),
  setSavedWatchLater: jest.fn(() => Promise.resolve()),
  restoreSavedWatchLater: jest.fn(() => Promise.resolve()),
  setSavedPinned: jest.fn(() => Promise.resolve()),
  deleteSavedMessages: jest.fn(() => Promise.resolve()),
  createSavedTag: jest.fn(),
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

const TAGS = [
  { id: 'tag-w', name: 'Работа', color: 0, usesCount: 5 },
  { id: 'tag-h', name: 'Дом', color: 1, usesCount: 3 },
  { id: 'tag-i', name: 'Идеи', color: 2, usesCount: 1 },
];

const noticeText = () => {
  const alert = useInAppAlert.getState().alert;

  return alert?.kind === 'notice' ? alert.text : null;
};

async function renderScreen(items: SavedMessage[]) {
  mocked(listSavedMessages).mockResolvedValue({ items, nextCursor: null });
  await renderWithQuery(<SavedScreen />);
  await screen.findByTestId(items.length > 0 ? 'saved-list' : 'saved-empty');
}

beforeEach(() => {
  jest.clearAllMocks();
  resetComposerDrafts();
  useInAppAlert.setState({ alert: null });
  (useSession as jest.Mock).mockReturnValue({
    session: { user: { id: 'user-1' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  mocked(listSavedTags).mockResolvedValue(TAGS);
  mocked(listSavedPins).mockResolvedValue([]);
  mocked(listWatchLater).mockResolvedValue({ items: [], nextCursor: null });
});

describe('SavedScreen — меню записи', () => {
  it('shows tags instead of reactions and only the saved actions', async () => {
    await renderScreen([saved('a', 2, { tagIds: ['tag-i'] })]);
    await longPressMessage('a');

    const block = await screen.findByTestId('saved-tag-block');
    const names = within(screen.getByTestId('message-menu'))
      .getAllByRole('menuitem')
      .map((item) => item.props.accessibilityLabel);

    expect(names).toEqual([
      'Ответить',
      'Посмотреть позже',
      'Копировать',
      'Выбрать',
      'Закрепить',
      'Переслать',
      'Удалить',
    ]);
    expect(screen.queryByTestId('reaction-picker')).toBeNull();
    // Выбранный тег — первым, хоть он и наименее популярный.
    expect(
      within(block)
        .getAllByRole('checkbox')
        .map((chip) => chip.props.accessibilityLabel)[0],
    ).toBe('Идеи');
  });

  it('toggles a tag right away and keeps the menu open', async () => {
    await renderScreen([saved('a', 2)]);
    await longPressMessage('a');

    await fireEvent.press(await screen.findByTestId('saved-tag-Дом'));

    expect(setSavedTag).toHaveBeenCalledWith('a', 'tag-h', true, requestClient());
    expect(screen.getByTestId('message-menu')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('saved-tag-Дом')).toBeChecked());
    // Тег и на облачке под затемнением.
    expect(within(screen.getAllByTestId('saved-row-a')[0]).getByText('Дом')).toBeTruthy();
  });

  it('«Посмотреть позже» puts the circle on the bubble; then the item toggles watched', async () => {
    await renderScreen([saved('a', 2)]);
    await longPressMessage('a');
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Посмотреть позже' }));

    await waitFor(() => expect(setSavedWatchLater).toHaveBeenCalledWith(['a'], 'later', requestClient()));
    expect((await screen.findAllByTestId('saved-watch-later'))[0]).not.toBeChecked();

    await longPressMessage('a');
    const toggle = await screen.findByRole('menuitem', { name: 'Не просмотрено' });

    expect(toggle.props.accessibilityState).toEqual({ checked: false });
    await fireEvent.press(toggle);
    await waitFor(() => expect(setSavedWatchLater).toHaveBeenCalledWith(['a'], 'done', requestClient()));
    await waitFor(() => expect(screen.getAllByTestId('saved-watch-later')[0]).toBeChecked());
  });

  it('deletes only after the confirmation', async () => {
    (confirm as jest.Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await renderScreen([saved('a', 2), saved('b', 1)]);

    await longPressMessage('a');
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Удалить' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Удалить из сохранённых?',
        message: 'Если оригинал уже удалён, вернуть копию будет нельзя',
      }),
    );
    expect(deleteSavedMessages).not.toHaveBeenCalled();

    await waitFor(() => expect(screen.queryByTestId('message-menu')).toBeNull());
    await longPressMessage('a');
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Удалить' }));

    await waitFor(() => expect(deleteSavedMessages).toHaveBeenCalledWith(['a'], requestClient()));
    await waitFor(() => expect(screen.queryByTestId('saved-row-a')).toBeNull());
    expect(screen.getByTestId('saved-row-b')).toBeTruthy();
  });

  it('pins and shows the pinned bar', async () => {
    await renderScreen([saved('a', 2)]);
    await longPressMessage('a');
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Закрепить' }));

    await waitFor(() => expect(setSavedPinned).toHaveBeenCalledWith(['a'], true, requestClient()));
    expect(await screen.findByTestId('pinned-bar')).toHaveProp(
      'accessibilityLabel',
      'Закреплённое сообщение: текст a',
    );
  });
});

describe('SavedScreen — пересылка', () => {
  it('a deleted original is not forwarded: only a notice, no sheet', async () => {
    mocked(listSavedForwardable).mockResolvedValue([{ savedId: 'a', live: false }]);
    mocked(listIslandOriginals).mockResolvedValue([]);
    mocked(listForwardedComments).mockResolvedValue([]);
    await renderScreen([saved('a', 2)]);

    await longPressMessage('a');
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Переслать' }));

    await waitFor(() => expect(noticeText()).toBe('Оригинал удалён — переслать нельзя'));
    expect(mockPush).not.toHaveBeenCalled();
    expect(readForwardPick()).toBeNull();
  });

  it('forwards the live original from its own chat', async () => {
    const live = original({ id: 'msg-a', chatId: 'chat-g' });

    mocked(listSavedForwardable).mockResolvedValue([
      { savedId: 'a', live: true, chatId: 'chat-g', messageId: 'msg-a', commentId: null },
    ]);
    mocked(listIslandOriginals).mockResolvedValue([live]);
    mocked(listForwardedComments).mockResolvedValue([]);
    await renderScreen([saved('a', 2)]);

    await longPressMessage('a');
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Переслать' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith({ name: 'Forward' }));
    expect(readForwardPick()).toEqual({
      batches: [
        { sourceChat: { id: 'chat-src', name: 'Джиган и Самойлова' }, items: [{ original: live }] },
      ],
      skipped: 0,
    });
  });
});

describe('SavedScreen — выбор', () => {
  it('selects like in a chat and deletes a batch after «Удалить N из сохранённых?»', async () => {
    (confirm as jest.Mock).mockResolvedValue(true);
    await renderScreen([saved('a', 3), saved('b', 2), saved('c', 1)]);

    await longPressMessage('a');
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Выбрать' }));
    await screen.findByTestId('selection-action-bar');
    await fireEvent.press(screen.getByTestId('message-row-c'));

    await waitFor(() =>
      expect(mockSetOptions).toHaveBeenLastCalledWith(
        expect.objectContaining({ title: 'Выбрано: 2' }),
      ),
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Удалить' }));

    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Удалить 2 из сохранённых?' }),
      ),
    );
    await waitFor(() => expect(deleteSavedMessages).toHaveBeenCalledWith(['c', 'a'], requestClient()));
    await waitFor(() => expect(screen.queryByTestId('selection-action-bar')).toBeNull());
  });
  it('switching to «Посмотреть позже» drops the selection and its header', async () => {
    await renderScreen([saved('a', 2), saved('b', 1)]);
    await longPressMessage('a');
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Выбрать' }));
    await screen.findByTestId('selection-action-bar');

    await fireEvent.press(screen.getByText('Посмотреть позже'));

    await waitFor(() => expect(screen.queryByTestId('selection-action-bar')).toBeNull());
    expect(mockSetOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Сохранённые сообщения' }),
    );
  });
});

describe('SavedScreen — «Посмотреть позже»', () => {
  async function openLater(items: SavedMessage[]) {
    mocked(listWatchLater).mockResolvedValue({ items, nextCursor: null });
    await renderScreen([]);
    await fireEvent.press(screen.getByText('Посмотреть позже'));
    await screen.findByTestId('watch-later-list');
  }

  const order = () =>
    screen
      .getAllByTestId(/^watch-later-row-/)
      .map((row) => row.props.testID.replace('watch-later-row-', ''));

  it('checks an item: it moves to the done ones, the newest done first', async () => {
    await openLater([
      saved('new', 3, { watchLaterAt: '2026-10-20T12:00:00Z' }),
      saved('old', 2, { watchLaterAt: '2026-10-19T12:00:00Z' }),
      saved('done', 1, {
        watchLaterAt: '2026-10-18T12:00:00Z',
        watchDoneAt: '2026-10-18T13:00:00Z',
      }),
    ]);

    expect(order()).toEqual(['new', 'old', 'done']);

    await fireEvent.press(screen.getByTestId('watch-later-check-new'));

    await waitFor(() => expect(order()).toEqual(['old', 'new', 'done']));
    expect(setSavedWatchLater).toHaveBeenCalledWith(['new'], 'done', requestClient());
    expect(screen.getByTestId('watch-later-check-new')).toBeChecked();
  });

  it('expands rows independently and collapses on a second tap', async () => {
    await openLater([
      saved('a', 2, { watchLaterAt: '2026-10-20T12:00:00Z' }),
      saved('b', 1, { watchLaterAt: '2026-10-19T12:00:00Z' }),
    ]);

    await fireEvent.press(screen.getByTestId('watch-later-row-a'));
    await fireEvent.press(screen.getByTestId('watch-later-row-b'));

    expect(await screen.findByTestId('saved-row-a')).toBeTruthy();
    expect(await screen.findByTestId('saved-row-b')).toBeTruthy();
    expect(screen.getAllByText('сохранено 20.10')).toHaveLength(2);

    await fireEvent.press(screen.getByTestId('watch-later-row-a'));
    await waitFor(() => expect(screen.queryByTestId('saved-row-a')).toBeNull());
    expect(screen.getByTestId('saved-row-b')).toBeTruthy();
  });

  it('a swipe past the threshold removes the row; «Вернуть» brings back the same dates', async () => {
    const item = saved('a', 2, {
      watchLaterAt: '2026-10-19T12:00:00Z',
      watchDoneAt: '2026-10-19T13:00:00Z',
    });

    await openLater([item]);

    await act(async () => {
      fireGestureHandler(getByGestureTestId('watch-later-swipe-a'), [
        { state: State.BEGAN, translationX: 0 },
        { state: State.ACTIVE, translationX: -40 },
        { state: State.ACTIVE, translationX: -200 },
        { state: State.END, translationX: -200 },
      ]);
    });

    await waitFor(() => expect(setSavedWatchLater).toHaveBeenCalledWith(['a'], 'off', requestClient()));
    await waitFor(() => expect(screen.queryByTestId('watch-later-row-a')).toBeNull());
    expect(noticeText()).toBe('Убрано из «Посмотреть позже»');

    const alert = useInAppAlert.getState().alert;

    await act(async () => {
      if (alert?.kind === 'notice') alert.action?.run();
    });

    expect(restoreSavedWatchLater).toHaveBeenCalledWith(
      'a',
      '2026-10-19T12:00:00Z',
      '2026-10-19T13:00:00Z', requestClient()
    );
    expect(await screen.findByTestId('watch-later-row-a')).toBeTruthy();
    expect(screen.getByTestId('watch-later-check-a')).toBeChecked();
  });

  it('a short swipe leaves the row in place', async () => {
    await openLater([saved('a', 2, { watchLaterAt: '2026-10-19T12:00:00Z' })]);

    await act(async () => {
      fireGestureHandler(getByGestureTestId('watch-later-swipe-a'), [
        { state: State.BEGAN, translationX: 0 },
        { state: State.ACTIVE, translationX: -40 },
        { state: State.END, translationX: -40 },
      ]);
    });

    expect(setSavedWatchLater).not.toHaveBeenCalled();
    expect(screen.getByTestId('watch-later-row-a')).toBeTruthy();
  });
});

describe('SavedScreen — закрепы', () => {
  it('keeps the loaded history when a distant pin is pressed', async () => {
    mocked(listSavedPins).mockResolvedValue([
      { id: 'far', seq: 5, kind: 'text', text: 'далёкий', thumbnailUrl: null },
    ]);
    await renderScreen([saved('top', 90)]);
    const calls = mocked(listSavedMessages).mock.calls.length;
    await fireEvent.press(await screen.findByTestId('pinned-bar'));
    expect(screen.getByTestId('saved-row-top')).toBeTruthy();
    expect(screen.queryByTestId('saved-row-far')).toBeNull();
    expect(listSavedMessages).toHaveBeenCalledTimes(calls);
  });
});
