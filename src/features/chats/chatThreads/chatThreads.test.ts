import { QueryClient } from '@tanstack/react-query';

import type { ChatSummary } from '@/api/chats';
import { isChatThreadReply } from '@/features/chats/chatThreads/replies';
import {
  bumpChatThreadSummaries,
  chatThreadSummariesKey,
  type ChatThreadSummaries,
} from '@/features/chats/chatThreads/summaries';
import { keepDeletedChatThreadRoots } from '@/features/chats/chatThreads/sync';
import {
  mergeChatThreadPage,
  type ChatThreadHistory,
} from '@/features/chats/chatThreads/threadCache';
import { withThreadQuotes } from '@/features/chats/chatThreads/useChatThreadPane';
import {
  chatThreadRootsOf,
  sentPreview,
} from '@/features/chats/chatThreads/useChatThreadReplies';
import { chatThreadsAvailable } from '@/features/chats/chatThreads/useChatThreadsMode';
import {
  messagesQueryKey,
  removeMessages,
  type ChatHistory,
} from '@/features/chats/messages/historyCache';
import type { ChatMessage, LiveQuote } from '@/features/chats/messages/types';

jest.mock('@/api/chats', () => ({
  deletedChatThreadRoot: (chatId: string, id: string, seq: number) => ({
    id,
    chatId,
    seq,
    chatThreadDeletedRoot: true,
    replies: [],
  }),
}));
jest.mock('@/features/chats/messages/sync', () => ({ pullNewMessages: jest.fn() }));

function message(id: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    chatId: 'chat-1',
    authorId: 'user-1',
    kind: 'text',
    text: id,
    seq: 1,
    createdAt: null,
    editedAt: null,
    edited: false,
    editMark: null,
    attachments: [],
    replies: [],
    forward: null,
    reactions: { members: {}, visitors: {}, mine: null },
    commentsCount: 0,
    viewsCount: 0,
    readAt: null,
    status: 'sent',
    ...overrides,
  };
}

function quote(messageId: string, via = false): LiveQuote {
  return {
    messageId,
    state: 'live',
    authorId: 'user-1',
    authorName: 'Автор',
    seq: 1,
    createdAt: null,
    editMark: null,
    preview: sentPreview({ kind: 'text', text: messageId }),
    via: via ? { forwardId: 'island-1', seq: 1 } : null,
  };
}

function group(participants: number, kind = 'group'): ChatSummary {
  return {
    kind,
    participants: Array.from({ length: participants }, (_, index) => ({ id: `p${index}` })),
  } as unknown as ChatSummary;
}

describe('chatThreadsAvailable', () => {
  it('есть в группе от трёх участников', () => {
    expect(chatThreadsAvailable(group(3))).toBe(true);
    expect(chatThreadsAvailable(group(5))).toBe(true);
  });

  it('нет в группе на двоих, в личке и в чате постов', () => {
    expect(chatThreadsAvailable(group(2))).toBe(false);
    expect(chatThreadsAvailable(group(3, 'direct'))).toBe(false);
    expect(chatThreadsAvailable(group(3, 'channel_posts'))).toBe(false);
    expect(chatThreadsAvailable(null)).toBe(false);
  });
});

describe('isChatThreadReply', () => {
  it('подтверждённое — по корням из базы', () => {
    expect(isChatThreadReply(message('a', { chatThreadRootIds: ['r'] }))).toBe(true);
    expect(isChatThreadReply(message('a', { chatThreadRootIds: null }))).toBe(false);
  });

  it('своё неотправленное — по цитатам: цитата оригинала из островка треда не создаёт', () => {
    expect(isChatThreadReply(message('a', { status: 'sending', replies: [quote('r')] }))).toBe(
      true,
    );
    expect(
      isChatThreadReply(message('a', { status: 'sending', replies: [quote('o', true)] })),
    ).toBe(false);
  });
});

describe('chatThreadRootsOf', () => {
  it('цитата на ответ — корни ответа, на не-ответ — само сообщение, на островок — ничего', () => {
    const queryClient = new QueryClient();
    const history: ChatHistory = {
      items: [message('reply', { chatThreadRootIds: ['root-1'] }), message('plain')],
      nextCursor: null,
    };

    queryClient.setQueryData(messagesQueryKey('chat-1'), history);

    expect(chatThreadRootsOf(queryClient, [quote('reply')])).toEqual(['root-1']);
    expect(chatThreadRootsOf(queryClient, [quote('plain')])).toEqual(['plain']);
    expect(chatThreadRootsOf(queryClient, [quote('original', true)])).toEqual([]);
    expect(chatThreadRootsOf(queryClient, [quote('reply'), quote('plain')])).toEqual([
      'root-1',
      'plain',
    ]);
  });
});

describe('withThreadQuotes', () => {
  const reply = message('r2', { replies: [quote('root'), quote('r1'), quote('other-root')] });
  const ids = (shown: ChatMessage) => shown.replies.map((item) => item.messageId);

  it('по ответу базы: только цитаты этого треда, корень не цитируется', () => {
    expect(ids(withThreadQuotes(reply, 'root', { r2: ['r1'] }, new Set()))).toEqual(['r1']);
  });

  it('без ответа базы (своё только что отправленное) — по загруженному треду', () => {
    expect(ids(withThreadQuotes(reply, 'root', undefined, new Set(['root', 'r1'])))).toEqual([
      'r1',
    ]);
  });
});

describe('bumpChatThreadSummaries', () => {
  it('свой ответ сразу: +1, я последним ответившим, мой текст', () => {
    const queryClient = new QueryClient();
    const key = chatThreadSummariesKey('chat-1');

    queryClient.setQueryData<ChatThreadSummaries>(key, {
      root: {
        rootId: 'root',
        repliesCount: 2,
        last: null,
        people: [
          { id: 'a', name: 'A', avatarUrl: null },
          { id: 'b', name: 'B', avatarUrl: null },
        ],
        othersCount: 1,
      },
    });

    bumpChatThreadSummaries(
      queryClient,
      'chat-1',
      ['root'],
      { id: 'me', name: 'Я', avatarUrl: null },
      sentPreview({ kind: 'text', text: 'мой ответ' }),
    );

    const summary = queryClient.getQueryData<ChatThreadSummaries>(key)?.root;

    expect(summary?.repliesCount).toBe(3);
    expect(summary?.people.map((person) => person.id)).toEqual(['me', 'a']);
    expect(summary?.othersCount).toBe(2);
    expect(summary?.last?.preview.text).toBe('мой ответ');
  });
});

describe('mergeChatThreadPage', () => {
  it('вливает ответы по порядку и запоминает их цитаты из треда', () => {
    const thread: ChatThreadHistory = {
      items: [message('root', { seq: 1 })],
      nextCursor: null,
      rootId: 'root',
      quotes: {},
      gap: null,
    };
    const merged = mergeChatThreadPage(thread, {
      items: [message('r1', { seq: 2 }), message('r2', { seq: 3 })],
      quotes: { r1: [], r2: ['r1'] },
    });

    expect(merged.items.map((item) => item.id)).toEqual(['r2', 'r1', 'root']);
    expect(merged.quotes).toEqual({ r1: [], r2: ['r1'] });
  });
});

describe('удалённое исходное в «Тредах»', () => {
  it('заглушка не уходит при сверке удалённого', () => {
    const history: ChatHistory = {
      items: [message('stub', { chatThreadDeletedRoot: true })],
      nextCursor: null,
    };

    expect(removeMessages(history, new Set(['stub']))).toBe(history);
  });

  it('удалённое с ответами становится заглушкой, без ответов — уходит', () => {
    const queryClient = new QueryClient();
    const key = messagesQueryKey('chat-1', 'chat-threads');

    queryClient.setQueryData<ChatHistory>(key, { items: [], nextCursor: null });
    queryClient.setQueryData<ChatThreadSummaries>(chatThreadSummariesKey('chat-1'), {
      withReplies: {
        rootId: 'withReplies',
        repliesCount: 1,
        last: null,
        people: [],
        othersCount: 0,
      },
      lonely: null,
    });

    keepDeletedChatThreadRoots(queryClient, 'chat-1', [
      message('withReplies', { seq: 5 }),
      message('lonely', { seq: 4 }),
    ]);

    const items = queryClient.getQueryData<ChatHistory>(key)?.items ?? [];

    expect(items.map((item) => [item.id, item.chatThreadDeletedRoot])).toEqual([
      ['withReplies', true],
    ]);
  });
});
