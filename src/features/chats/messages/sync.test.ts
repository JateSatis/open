import { QueryClient } from '@tanstack/react-query';

import * as chatsApi from '@/api/chats';
import { messageWindowKey, messagesQueryKey, type ChatHistory } from '@/features/chats/messages/historyCache';
import type { ChatMessage } from '@/features/chats/messages/types';
import { pullNewMessages } from './sync';

jest.mock('@/api/chats', () => ({
  deletedChatThreadRoot: jest.fn(),
  listCommentCounts: jest.fn(),
  listClusterCounts: jest.fn(),
  listDeletedMessageIds: jest.fn(),
  listMessageEdits: jest.fn(),
  listMessages: jest.fn(),
  listMessagesByIds: jest.fn(),
  listMessagesSince: jest.fn(),
  listChatThreadFeed: jest.fn(),
  listChatThreadFeedSince: jest.fn(),
  MESSAGE_PAGE_SIZE: 30,
}));
jest.mock('@/api/messageViews', () => ({ listMessageViews: jest.fn() }));
jest.mock('@/api/reactions', () => ({ listMessageReactions: jest.fn() }));

function message(seq: number): ChatMessage {
  return {
    id: `m-${seq}`, chatId: 'chat-1', authorId: 'user-1', kind: 'text', text: `${seq}`,
    seq, createdAt: '2026-11-03T10:00:00Z', editedAt: null, edited: false, editMark: null,
    attachments: [], replies: [], forward: null,
    reactions: { members: {}, visitors: {}, mine: null },
    commentsCount: 0, viewsCount: 0, readAt: null, status: 'sent',
  };
}

describe('pullNewMessages with a detached window', () => {
  afterEach(() => jest.restoreAllMocks());

  it('adds realtime arrivals to the live tail without moving the detached window', async () => {
    const client = new QueryClient();
    const tail: ChatHistory = { items: [message(30)], nextCursor: 1 };
    const window: ChatHistory = {
      items: [message(10), message(9)], nextCursor: 1, newerCursor: 10,
    };
    client.setQueryData(messagesQueryKey('chat-1'), tail);
    client.setQueryData(messageWindowKey('chat-1', 10), window);
    jest.spyOn(chatsApi, 'listMessagesSince').mockResolvedValue([message(31)]);

    const incoming = await pullNewMessages(client, 'chat-1');

    expect(incoming.map((item) => item.seq)).toEqual([31]);
    expect(client.getQueryData<ChatHistory>(messagesQueryKey('chat-1'))?.items.map((item) => item.seq)).toEqual([31, 30]);
    expect(client.getQueryData<ChatHistory>(messageWindowKey('chat-1', 10))).toEqual(window);
  });
});
