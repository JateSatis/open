import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import { CommentsPanel } from '.';

import {
  getPinnedComment,
  getPopCommentTarget,
  listThreadRoots,
  pinComment,
  sendComment,
  sendPopComment,
  subscribeToComments,
  unpinComment,
  type Comment,
  type CommentTarget,
} from '@/api/comments';
import { useSession } from '@/features/auth/useSession';
import {
  finishForwardPick,
  readChatDraft,
  resetComposerDrafts,
} from '@/features/chats/composerDraftStore';
import { reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { resetCommentOutbox } from '@/features/interactions/comments/commentOutbox';
import { closeComments, openPopComments } from '@/features/interactions/comments/commentsPanelStore';
import { renderWithQuery } from '@/test/renderWithQuery';
import { longPressMessage } from '@/test/messageGestures';

const mockedPush = jest.fn();

jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useRouter: () => ({ push: mockedPush, navigate: jest.fn(), back: jest.fn() }),
}));
jest.mock('@/api/profile', () => ({
  getProfile: jest.fn(() => Promise.resolve(null)),
  getMyProfile: jest.fn(() =>
    Promise.resolve({ id: 'user-3', displayName: 'Пётр', avatarUrl: null }),
  ),
}));
jest.mock('@/features/auth/useSession', () => ({ useSession: jest.fn() }));
jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/api/chats', () => ({ getChat: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@/api/pins', () => ({
  listPinnedMessages: jest.fn(() => Promise.resolve([])),
  pinMessage: jest.fn(),
  unpinMessage: jest.fn(),
}));
jest.mock('@/api/comments', () => ({
  getPinnedComment: jest.fn(() => Promise.resolve(null)),
  pinComment: jest.fn(() => Promise.resolve()),
  unpinComment: jest.fn(() => Promise.resolve()),
  COMMENT_PAGE_SIZE: 30,
  THREAD_PAGE_SIZE: 10,
  listThreadRoots: jest.fn(),
  listThreadReplies: jest.fn(() => Promise.resolve({ items: [], nextCursor: null })),
  fetchComment: jest.fn(),
  listCommentsByIds: jest.fn(() => Promise.resolve([])),
  getCommentTarget: jest.fn(),
  getPopCommentTarget: jest.fn(),
  sendComment: jest.fn(),
  sendPopComment: jest.fn(),
  sendVoiceComment: jest.fn(),
  sendVoicePopComment: jest.fn(),
  deleteComment: jest.fn(),
  editComment: jest.fn(),
  setCommentReaction: jest.fn(),
  listCommentReactions: jest.fn(() => Promise.resolve([])),
  subscribeToComments: jest.fn(() => () => undefined),
}));
jest.mock('@/components/ConfirmDialog', () => ({
  confirm: jest.fn(),
  ConfirmDialogSurface: () => null,
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Medium: 'medium' },
}));
jest.mock('@/features/media', () => ({
  ...jest.requireActual('@/test/outgoingMediaMock').outgoingMediaMock,
  ...jest.requireActual('@/features/media/selectionStore'),
  assetPreviewUri: (asset: { id: string }) => asset.id,
  MediaGrid: () => null,
  MediaViewer: () => null,
  VoicePlayer: () => null,
  stopVoice: jest.fn(),
}));
jest.mock('@/features/media/HoldToRecordRow', () => ({
  HoldToRecordRow: ({ children }: { children: unknown }) => children,
}));
jest.mock('@/features/media/galleryPrefetch', () => ({ prefetchGallery: jest.fn() }));

const mockedSession = useSession as jest.MockedFunction<typeof useSession>;
const mockedRoots = listThreadRoots as jest.MockedFunction<typeof listThreadRoots>;
const mockedTarget = getPopCommentTarget as jest.MockedFunction<typeof getPopCommentTarget>;
const mockedSendPop = sendPopComment as jest.MockedFunction<typeof sendPopComment>;
const mockedPinned = getPinnedComment as jest.MockedFunction<typeof getPinnedComment>;
const mockedSubscribe = subscribeToComments as jest.MockedFunction<typeof subscribeToComments>;

const LIVE_POP: CommentTarget = {
  state: 'pop',
  pop: {
    id: 'pop-1',
    channelId: 'channel-1',
    channelTitle: 'Канал A',
    postsChatId: 'posts-1',
    commentsCount: 3,
    posterUrl: 'https://cdn.test/p.jpg',
    caption: 'Подпись попа',
  },
};

function comment(id: string, overrides: Partial<Comment> = {}): Comment {
  return {
    id,
    targetId: 'pop-1',
    chatId: 'posts-1',
    authorId: 'user-2',
    authorName: 'Олег',
    authorAvatarUrl: null,
    audience: 'visitor',
    kind: 'text',
    text: `комментарий ${id}`,
    createdAt: '2026-10-11T11:00:00Z',
    editedAt: null,
    attachments: [],
    reactions: { members: {}, visitors: {}, mine: null },
    replies: [],
    threadRootId: null,
    fragmentId: null,
    repliesCount: 0,
    rank: 0,
    deleted: false,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetCommentOutbox();
  resetComposerDrafts();
  resetConnectionState();
  reportRealtimeJoined();
  closeComments();
  // Смотрит посторонний: не публикует в канале.
  mockedSession.mockReturnValue({
    session: { user: { id: 'user-3' } } as unknown as SupabaseSession,
    isAuthenticated: true,
    isLoading: false,
  });
  mockedTarget.mockResolvedValue(LIVE_POP);
  mockedPinned.mockResolvedValue(null);
  mockedRoots.mockResolvedValue({
    items: [
      comment('c1', { authorName: 'Марина', authorId: 'user-1', audience: 'member' }),
      comment('c2'),
    ],
    nextCursor: null,
  });
  jest
    .spyOn(BackHandler, 'addEventListener')
    .mockImplementation(() => ({ remove: () => undefined }));
});

async function openPanel(asPublisher = false) {
  await renderWithQuery(<CommentsPanel onOpenPerson={jest.fn()} />);
  await act(async () => openPopComments('pop-1', asPublisher));
  await screen.findByTestId('comments-panel');
  await screen.findByText('комментарий c1');
}

/**
 * Id комментария под меткой закрепа. Порядок строк по дереву не проверить:
 * FlashList переиспользует ячейки, и их место в дереве — не место на экране.
 */
function pinnedShown(): string | null {
  const labels = screen.queryAllByTestId('comment-pinned-label');

  expect(labels.length).toBeLessThanOrEqual(1);

  let node = labels[0]?.parent ?? null;

  while (node) {
    const [row] = within(node).queryAllByTestId(/^message-row-/);

    if (row) return String(row.props.testID).replace('message-row-', '');

    node = node.parent;
  }

  return null;
}

/** Долгое нажатие на комментарий — его меню. */
const tapComment = longPressMessage;

describe('comments of a pop', () => {
  it('lists the pop’s comments with the count and marks the channel’s publisher as the author', async () => {
    await openPanel();

    expect(mockedRoots).toHaveBeenCalledWith('pop-1');
    expect(screen.getByText('3 комментария')).toBeTruthy();
    expect(screen.getAllByText(/Автор/)).toHaveLength(1);
    expect(screen.queryByText(/участник чата/)).toBeNull();
  });

  it('sends a comment to the pop, not to a message', async () => {
    mockedSendPop.mockReturnValue(new Promise(() => undefined));
    await openPanel();

    await fireEvent.changeText(screen.getByPlaceholderText('Комментарий'), 'к попу');
    await fireEvent.press(screen.getByLabelText('Отправить'));

    expect(await screen.findByText('к попу')).toBeTruthy();
    expect(mockedSendPop).toHaveBeenCalledWith('pop-1', {
      text: 'к попу',
      media: [],
      replyTo: [],
      threadRootId: null,
    });
    expect(sendComment).not.toHaveBeenCalled();
  });

  it('forwards a pop comment from the menu: the chat will quote the pop under the channel’s name', async () => {
    await openPanel();

    await tapComment('c2');
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Переслать' }));

    expect(mockedPush).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/chats/forward' }),
    );
    expect(finishForwardPick('chat-dest')).toBe(true);

    const mode = readChatDraft('chat-dest').mode;
    const [forwarded] = mode?.type === 'forward_comments' ? mode.comments : [];

    expect(forwarded).toMatchObject({
      id: 'c2',
      subject: { type: 'pop', id: 'pop-1' },
      target: null,
      pop: { id: 'pop-1', channelId: 'channel-1', caption: 'Подпись попа' },
      chat: { id: 'posts-1', name: 'Канал A' },
    });
  });

  it('forwards several pop comments from the selection bar', async () => {
    await openPanel();

    await tapComment('c2');
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Выбрать' }));
    await waitFor(() => expect(screen.getByLabelText('Переслать')).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByTestId('message-row-c1'));
    });
    await fireEvent.press(screen.getByLabelText('Переслать'));

    expect(finishForwardPick('chat-dest')).toBe(true);

    const mode = readChatDraft('chat-dest').mode;

    expect(mode?.type === 'forward_comments' ? mode.comments.map((c) => c.id).sort() : []).toEqual([
      'c1',
      'c2',
    ]);
  });

  it('says the pop is gone and takes no new comments once it is deleted', async () => {
    mockedTarget.mockResolvedValue({ state: 'deleted' });
    await openPanel();

    expect(
      await screen.findByText('Поп удалён — новые комментарии не принимаются.'),
    ).toBeTruthy();
    expect(screen.queryByPlaceholderText('Комментарий')).toBeNull();
  });

  it('listens to the pop’s own comments topic', async () => {
    await openPanel();

    expect(subscribeToComments).toHaveBeenCalledWith('pop-1', expect.anything());
  });

  describe('pin', () => {
    it('shows the pinned comment first with the label, without a repeat below', async () => {
      mockedPinned.mockResolvedValue(comment('c2', { text: 'закреплённый' }));
      mockedRoots.mockResolvedValue({ items: [comment('c1')], nextCursor: null });
      await openPanel();

      expect(await screen.findByText('Закреплено автором')).toBeTruthy();
      expect(pinnedShown()).toBe('c2');
      // Ниже закреплённый не повторяется.
      expect(screen.getAllByText('закреплённый')).toHaveLength(1);
    });

    it('lets the channel’s publisher pin a comment: it is marked at once', async () => {
      await openPanel(true);
      expect(pinnedShown()).toBeNull();

      await tapComment('c2');
      await fireEvent.press(await screen.findByRole('menuitem', { name: 'Закрепить' }));

      expect(pinComment).toHaveBeenCalledWith('c2');
      expect(await screen.findByText('Закреплено автором')).toBeTruthy();
      expect(pinnedShown()).toBe('c2');
    });

    it('lets the publisher unpin: the comment stays, without the label', async () => {
      mockedPinned.mockResolvedValue(comment('c2'));
      mockedRoots.mockResolvedValue({ items: [comment('c1', { rank: 5 })], nextCursor: null });
      await openPanel(true);
      await screen.findByText('Закреплено автором');

      await tapComment('c2');
      await fireEvent.press(await screen.findByRole('menuitem', { name: 'Открепить' }));

      expect(unpinComment).toHaveBeenCalledWith('pop-1');
      await waitFor(() => expect(screen.queryByText('Закреплено автором')).toBeNull());
      expect(screen.getByTestId('message-row-c2')).toBeTruthy();
    });

    it('offers no pin to a visitor', async () => {
      await openPanel();

      await tapComment('c2');
      await screen.findByTestId('message-menu');

      expect(screen.queryByRole('menuitem', { name: 'Закрепить' })).toBeNull();
    });

    it('picks up somebody else’s pin live from the topic', async () => {
      await openPanel();
      expect(screen.queryByText('Закреплено автором')).toBeNull();

      mockedPinned.mockResolvedValue(comment('c2'));
      const listener = mockedSubscribe.mock.calls[0][1];

      await act(async () => listener.onPinChanged?.());

      expect(await screen.findByText('Закреплено автором')).toBeTruthy();
      expect(pinnedShown()).toBe('c2');
    });
  });
});
