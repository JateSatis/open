import { byChatListOrder, chatListOrderAt } from './chatListOrder';
import { toSummary, type ChatSummary } from './chats';

jest.mock('@/api/supabase', () => ({ supabase: {} }));

type ChatRow = Parameters<typeof toSummary>[0];
type People = Parameters<typeof toSummary>[1];

function row(id: string, lastMessageAt: string | null): ChatRow {
  return {
    id,
    kind: 'group',
    title: id,
    username: null,
    avatar_url: null,
    owner_id: null,
    description: null,
    created_by: null,
    request_pending: false,
    last_message_at: lastMessageAt,
    last_message_preview: null,
    last_message_author_id: null,
    subscribers_count: 0,
    channel: null,
  } as ChatRow;
}

function joined(at: string): People {
  return {
    members: [
      {
        chat_id: 'x',
        user_id: 'me',
        last_read_at: at,
        joined_at: at,
        profile: null,
      },
    ] as unknown as People['members'],
    waiting: [],
  };
}

const order = (chats: ChatSummary[]) => [...chats].sort(byChatListOrder).map((chat) => chat.id);

describe('chat list order', () => {
  it('puts a chat I just joined above older activity, though it has no messages', () => {
    const old = toSummary(row('old', '2026-10-01T10:00:00Z'), joined('2026-09-01T00:00:00Z'), 'me');
    const fresh = toSummary(row('fresh', null), joined('2026-10-19T09:00:00Z'), 'me');

    expect(order([old, fresh])).toEqual(['fresh', 'old']);
  });

  it('lifts a chat with a new message above the one I joined before it', () => {
    const joinedEarlier = toSummary(row('joined', null), joined('2026-10-19T09:00:00Z'), 'me');
    const written = toSummary(
      row('written', '2026-10-19T09:01:00Z'),
      joined('2026-09-01T00:00:00Z'),
      'me',
    );

    expect(order([joinedEarlier, written])).toEqual(['written', 'joined']);
  });

  it('takes the moment a subscription got into «Чаты» for a subscriber', () => {
    const channel = toSummary(
      row('channel', '2026-01-01T00:00:00Z'),
      { members: [], waiting: [] },
      'me',
      {
        channelId: 'c',
        chatId: 'channel',
        inChats: true,
        notify: true,
        unreadPosts: 0,
        unreadPops: 0,
        inChatsAt: '2026-10-19T09:00:00Z',
      },
    );
    const other = toSummary(
      row('other', '2026-10-18T00:00:00Z'),
      joined('2026-09-01T00:00:00Z'),
      'me',
    );

    expect(channel.enteredAt).toBe('2026-10-19T09:00:00Z');
    expect(order([other, channel])).toEqual(['channel', 'other']);
    // Время в строке — по-прежнему последнего поста.
    expect(channel.lastActivityAt).toBe('2026-01-01T00:00:00Z');
  });

  it('compares moments, not text: different zone notation does not reorder', () => {
    const summary = toSummary(
      row('a', '2026-10-19T09:00:00.5+00:00'),
      joined('2026-10-19T09:00:00Z'),
      'me',
    );

    expect(chatListOrderAt(summary)).toBe('2026-10-19T09:00:00.5+00:00');
  });

  it('keeps chats without activity and without an entry moment at the end', () => {
    const empty = toSummary(row('empty', null), { members: [], waiting: [] }, 'me');
    const any = toSummary(row('any', '2026-01-01T00:00:00Z'), { members: [], waiting: [] }, 'me');

    expect(order([empty, any])).toEqual(['any', 'empty']);
  });
});
