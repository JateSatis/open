import { QueryClient } from '@tanstack/react-query';

import { sendCommentPost } from './commentDelivery';
import { outboxComments, resetCommentOutbox } from './commentOutbox';

import { sendComment } from '@/api/comments';

jest.mock('@/api/comments', () => ({
  sendComment: jest.fn(),
  sendPopComment: jest.fn(),
  sendVoiceComment: jest.fn(),
  sendVoicePopComment: jest.fn(),
  deleteComment: jest.fn(),
}));

jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/features/media', () => jest.requireActual('@/test/outgoingMediaMock').outgoingMediaMock);

const mockedSend = jest.mocked(sendComment);

describe('a comment to a fragment, sent from its panel', () => {
  beforeEach(() => {
    resetCommentOutbox();
    // До ответа сервера — облачко живёт только в исходящих.
    mockedSend.mockReturnValue(new Promise(() => undefined));
  });

  it('carries the quote of the selected piece before the server answers', () => {
    sendCommentPost(
      {
        queryClient: new QueryClient(),
        subject: { type: 'message', id: 'm1' },
        chatId: 'chat-1',
        currentUserId: 'user-3',
        me: { name: 'Пётр', avatarUrl: null },
        fragment: {
          key: 'm1:4-27',
          set: { kind: 'area', start: 4, end: 27 },
          request: { start: 4, end: 27, text: 'какой-то другой уровень' },
        },
      },
      'про кусок',
    );

    const [draft] = outboxComments('m1');

    expect(draft.fragmentQuote).toEqual({
      text: 'какой-то другой уровень',
      start: 4,
      end: 27,
      lost: false,
    });
  });

  it('tells the panel once the comment reached the base — for the cluster event', async () => {
    const onSent = jest.fn();

    mockedSend.mockImplementation(async () => ({
        id: 'c1',
        targetId: 'm1',
        chatId: 'chat-1',
        authorId: 'user-3',
        authorName: 'Пётр',
        authorAvatarUrl: null,
        audience: 'visitor',
        kind: 'text',
        text: 'про кусок',
        createdAt: '2026-10-16T10:00:00Z',
        editedAt: null,
        attachments: [],
        reactions: { members: {}, visitors: {}, mine: null },
        replies: [],
        commentThreadRootId: null,
        fragmentId: 'f1',
        fragmentQuote: null,
        repliesCount: 0,
        rank: 0,
        deleted: false,
    }));

    sendCommentPost(
      {
        queryClient: new QueryClient(),
        subject: { type: 'message', id: 'm1' },
        chatId: 'chat-1',
        currentUserId: 'user-3',
        me: { name: 'Пётр', avatarUrl: null },
        fragment: {
          key: 'cluster:k1',
          set: { kind: 'cluster', clusterId: 'k1' },
          request: { start: 4, end: 27, text: 'какой-то другой уровень' },
          onSent,
        },
      },
      'про кусок',
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it('a plain comment has no quote', () => {
    sendCommentPost(
      {
        queryClient: new QueryClient(),
        subject: { type: 'message', id: 'm1' },
        chatId: 'chat-1',
        currentUserId: 'user-3',
        me: { name: 'Пётр', avatarUrl: null },
      },
      'просто так',
    );

    expect(outboxComments('m1')[0].fragmentQuote).toBeUndefined();
  });
});
