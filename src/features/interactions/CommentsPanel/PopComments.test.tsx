import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import { CommentsPanel } from '.';

import {
  getPopCommentTarget,
  listThreadRoots,
  sendComment,
  sendPopComment,
  subscribeToComments,
  type Comment,
  type CommentTarget,
} from '@/api/comments';
import { useSession } from '@/features/auth/useSession';
import { resetComposerDrafts } from '@/features/chats/composerDraftStore';
import { reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { resetCommentOutbox } from '@/features/interactions/comments/commentOutbox';
import { closeComments, openPopComments } from '@/features/interactions/comments/commentsPanelStore';
import { renderWithQuery } from '@/test/renderWithQuery';

jest.mock('expo-router', () => ({
  useIsFocused: () => true,
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), back: jest.fn() }),
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

const LIVE_POP: CommentTarget = {
  state: 'pop',
  pop: {
    id: 'pop-1',
    channelId: 'channel-1',
    channelTitle: 'Канал A',
    postsChatId: 'posts-1',
    commentsCount: 3,
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

async function openPanel() {
  await renderWithQuery(<CommentsPanel onOpenPerson={jest.fn()} />);
  await act(async () => openPopComments('pop-1'));
  await screen.findByTestId('comments-panel');
  await screen.findByText('комментарий c1');
}

async function tapComment(id: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(`message-row-${id}`));
  });
}

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

  it('offers no forwarding of a pop comment — neither in the menu nor in the selection bar', async () => {
    await openPanel();

    await tapComment('c2');
    await screen.findByTestId('message-menu');

    expect(screen.getByRole('menuitem', { name: 'Ответить' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Переслать' })).toBeNull();

    await fireEvent.press(screen.getByRole('menuitem', { name: 'Выбрать' }));

    await waitFor(() => expect(screen.getByLabelText('Ответить')).toBeTruthy());
    expect(screen.queryByLabelText('Переслать')).toBeNull();
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
});
