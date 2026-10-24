import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { ForwardSheet } from './index';

import { listChats, type ChatSummary, type ForwardedComment } from '@/api/chats';
import { createSavedTag, listSavedTags, saveComments, saveMessages } from '@/api/saved';
import { useSession } from '@/features/auth/useSession';
import type { ForwardPick } from '@/features/chats/composerDraftStore';
import { sendCommentForward, sendForward } from '@/features/chats/messages/delivery';
import { useInAppAlert } from '@/features/notifications/alertsStore';
import { original } from '@/test/islands';
import { renderWithQuery } from '@/test/renderWithQuery';

jest.mock('@/features/auth/useSession', () => ({ useSession: jest.fn() }));
jest.mock('@/api/chats', () => ({ listChats: jest.fn() }));
jest.mock('@/api/saved', () => ({
  listSavedTags: jest.fn(),
  createSavedTag: jest.fn(),
  saveMessages: jest.fn(),
  saveComments: jest.fn(),
}));
jest.mock('@/features/chats/messages/delivery', () => ({
  sendForward: jest.fn(() => ({ delivered: Promise.resolve() })),
  sendCommentForward: jest.fn(() => ({ delivered: Promise.resolve() })),
}));

const mockedListChats = listChats as jest.MockedFunction<typeof listChats>;
const mockedTags = listSavedTags as jest.MockedFunction<typeof listSavedTags>;
const mockedCreateTag = createSavedTag as jest.MockedFunction<typeof createSavedTag>;
const mockedSaveMessages = saveMessages as jest.MockedFunction<typeof saveMessages>;
const mockedSaveComments = saveComments as jest.MockedFunction<typeof saveComments>;
const mockedSendForward = sendForward as jest.MockedFunction<typeof sendForward>;
const mockedSendComments = sendCommentForward as jest.MockedFunction<typeof sendCommentForward>;

function group(id: string, title: string): ChatSummary {
  return {
    id,
    kind: 'group',
    ownerId: null,
    description: null,
    avatarUrl: null,
    title,
    participants: [{ id: 'user-1', displayName: 'Я', avatarUrl: null, lastReadAt: null }],
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

const SOURCE = { id: 'chat-src', name: 'Откуда' };
const messagesPick: ForwardPick = {
  sourceChat: SOURCE,
  items: [{ original: original({ id: 'm-2' }) }, { original: original({ id: 'm-1' }) }],
};

const onSent = jest.fn();

async function renderSheet(pick: ForwardPick = messagesPick) {
  await renderWithQuery(<ForwardSheet pick={pick} onSent={onSent} />);
  await screen.findByText('Альфа');
}

const send = () => fireEvent.press(screen.getByTestId('forward-send'));
const noticeText = () => {
  const alert = useInAppAlert.getState().alert;

  return alert?.kind === 'notice' ? alert.text : null;
};

beforeEach(() => {
  jest.clearAllMocks();
  useInAppAlert.setState({ alert: null });
  (useSession as jest.Mock).mockReturnValue({
    session: { user: { id: 'user-1' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  mockedListChats.mockResolvedValue([group('chat-a', 'Альфа'), group('chat-b', 'Бета')]);
  mockedTags.mockResolvedValue([
    { id: 'tag-work', name: 'Работа', color: 0, usesCount: 3 },
    { id: 'tag-home', name: 'Дом', color: 1, usesCount: 1 },
  ]);
  mockedSaveMessages.mockResolvedValue(['s-1']);
  mockedSaveComments.mockResolvedValue(['s-1']);
});

describe('ForwardSheet', () => {
  it('picks several chats with a tap, unpicks with another, and sends nowhere until one is picked', async () => {
    await renderSheet();
    // Область настроек раскрывается только по «Настроить»; пока — строка «Сохранённые».
    await fireEvent.press(screen.getByTestId('forward-saved-configure'));
    await fireEvent.press(screen.getByTestId('forward-saved-configure'));

    expect(screen.getByTestId('forward-send')).toBeDisabled();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Альфа' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Бета' }));

    expect(screen.getByRole('checkbox', { name: 'Альфа' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Бета' })).toBeChecked();
    expect(screen.getByTestId('forward-send')).toBeEnabled();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Бета' }));
    expect(screen.getByRole('checkbox', { name: 'Бета' })).not.toBeChecked();
  });

  it('forwards to every picked chat with the caption, in screen order, and says «Переслано»', async () => {
    await renderSheet();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Альфа' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Бета' }));
    await fireEvent.changeText(screen.getByTestId('forward-caption'), 'смотри');
    await send();

    expect(mockedSendForward).toHaveBeenCalledTimes(2);
    for (const chatId of ['chat-a', 'chat-b']) {
      expect(mockedSendForward).toHaveBeenCalledWith(
        expect.objectContaining({ chatId, currentUserId: 'user-1' }),
        'смотри',
        SOURCE,
        messagesPick.items,
        expect.any(Promise),
      );
    }
    expect(mockedSaveMessages).not.toHaveBeenCalled();
    expect(noticeText()).toBe('Переслано');
    expect(onSent).toHaveBeenCalled();
  });

  it('sends once, even when «Отправить» is tapped twice before the sheet goes away', async () => {
    await renderSheet();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Альфа' }));
    await fireEvent.press(screen.getByTestId('forward-saved-row'));
    await send();
    await send();

    expect(mockedSendForward).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockedSaveMessages).toHaveBeenCalledTimes(1));
  });

  it('keeps the picked chats when the search is cleared', async () => {
    await renderSheet();

    await fireEvent.changeText(screen.getByLabelText('Поиск чата'), 'Бет');
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Бета' }));
    expect(screen.queryByRole('checkbox', { name: 'Альфа' })).toBeNull();
    // «Сохранённые» — первой строкой и в результатах поиска.
    expect(screen.getByTestId('forward-saved-row')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Поиск чата'), '');
    expect(screen.getByRole('checkbox', { name: 'Бета' })).toBeChecked();
  });

  it('saves to «Сохранённые» without tags and without the caption, and says «Сохранено»', async () => {
    await renderSheet();

    await fireEvent.press(screen.getByTestId('forward-saved-row'));
    await fireEvent.changeText(screen.getByTestId('forward-caption'), 'подпись');
    await send();

    await waitFor(() =>
      expect(mockedSaveMessages).toHaveBeenCalledWith('chat-src', ['m-2', 'm-1'], {
        tagIds: [],
        watchLater: false,
      }),
    );
    expect(mockedSendForward).not.toHaveBeenCalled();
    expect(noticeText()).toBe('Сохранено');
  });

  it('a tag or «Посмотреть позже» picks «Сохранённые» by itself; with a chat it says «Переслано и сохранено»', async () => {
    await renderSheet();

    await fireEvent.press(screen.getByTestId('forward-saved-configure'));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Работа' }));

    expect(screen.getByTestId('forward-saved-row')).toBeChecked();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Дом' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Посмотреть позже' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Альфа' }));
    await send();

    expect(mockedSendForward).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(mockedSaveMessages).toHaveBeenCalledWith('chat-src', ['m-2', 'm-1'], {
        tagIds: ['tag-work', 'tag-home'],
        watchLater: true,
      }),
    );
    expect(noticeText()).toBe('Переслано и сохранено');
  });

  it('creates a new tag right away from «+», first after it and already picked', async () => {
    mockedCreateTag.mockResolvedValue({ id: 'tag-new', name: 'Идеи', color: 2, usesCount: 0 });
    await renderSheet();

    await fireEvent.press(screen.getByTestId('forward-saved-configure'));
    await fireEvent.press(screen.getByTestId('saved-tag-add'));
    await fireEvent.changeText(screen.getByTestId('saved-tag-name'), '  Идеи ');
    await act(async () => {
      fireEvent(screen.getByTestId('saved-tag-name'), 'submitEditing');
    });

    expect(mockedCreateTag).toHaveBeenCalledTimes(1);
    expect(mockedCreateTag).toHaveBeenCalledWith('Идеи');
    expect(await screen.findByRole('checkbox', { name: 'Идеи' })).toBeChecked();
    expect(screen.getByTestId('forward-saved-row')).toBeChecked();

    const chips = screen.getAllByRole('checkbox').map((node) => node.props.accessibilityLabel);
    expect(chips.indexOf('Идеи')).toBeLessThan(chips.indexOf('Работа'));
  });

  it('shows ten most used tags and the rest behind «Показать все»', async () => {
    mockedTags.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        id: `t-${index}`,
        name: index === 0 ? 'Работа' : `Тег ${index}`,
        color: index,
        usesCount: 12 - index,
      })),
    );
    await renderSheet();

    await fireEvent.press(screen.getByTestId('forward-saved-configure'));
    expect(screen.queryByText('Тег 11')).toBeNull();

    await fireEvent.press(screen.getByText('Показать все'));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Тег 11' }));
    await fireEvent.press(screen.getByText('Свернуть'));

    expect(screen.queryByText('Тег 11')).toBeNull();
    await fireEvent.press(screen.getByText('Показать все'));
    expect(screen.getByRole('checkbox', { name: 'Тег 11' })).toBeChecked();
  });

  it('forwards and saves comments from the panel the same way', async () => {
    const comment = { id: 'c-1' } as ForwardedComment;
    await renderSheet({ comments: [comment] });

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Альфа' }));
    await fireEvent.press(screen.getByTestId('forward-saved-row'));
    await send();

    expect(mockedSendComments).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'chat-a' }),
      '',
      [comment],
      expect.any(Promise),
    );
    await waitFor(() =>
      expect(mockedSaveComments).toHaveBeenCalledWith(['c-1'], { tagIds: [], watchLater: false }),
    );
  });

  it('offers «Повторить» when saving fails, and the retry saves again', async () => {
    mockedSaveMessages.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'XX000' }));
    await renderSheet();

    await fireEvent.press(screen.getByTestId('forward-saved-row'));
    await send();

    await waitFor(() => expect(noticeText()).toBe('Не удалось сохранить'));

    const alert = useInAppAlert.getState().alert;

    await act(async () => {
      if (alert?.kind === 'notice') alert.action?.run();
    });
    expect(mockedSaveMessages).toHaveBeenCalledTimes(2);
  });
  it('sends several batches — an island per source chat and the comments — with the caption once, and names the skipped', async () => {
    const other = { id: 'chat-other', name: 'Другой' };
    const comment = { id: 'c-1' } as ForwardedComment;
    const first = { sourceChat: SOURCE, items: [{ original: original({ id: 'm-1' }) }] };
    const second = {
      sourceChat: other,
      items: [{ original: original({ id: 'm-9', chatId: 'chat-other' }) }],
    };

    await renderSheet({ batches: [first, second, { comments: [comment] }], skipped: 2 });

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Альфа' }));
    await fireEvent.changeText(screen.getByTestId('forward-caption'), 'смотри');
    await send();

    expect(mockedSendForward).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ chatId: 'chat-a' }),
      'смотри',
      SOURCE,
      first.items,
      expect.any(Promise),
    );
    expect(mockedSendForward).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ chatId: 'chat-a' }),
      '',
      other,
      second.items,
      expect.any(Promise),
    );
    expect(mockedSendComments).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'chat-a' }),
      '',
      [comment],
      expect.any(Promise),
    );
    expect(noticeText()).toBe('Переслано 3 из 5: оригиналы двух удалены');
  });
});
