import {
  nextSearchPopsCursor,
  SEARCH_MESSAGES_PAGE_SIZE,
  SEARCH_POPS_PAGE_SIZE,
  searchChannels,
  searchEntities,
  searchMessages,
  searchPops,
  type SearchMessage,
} from './search';

import { supabase } from '@/api/supabase';

jest.mock('@/api/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

const mockedRpc = supabase.rpc as unknown as jest.Mock;

/** Ответ rpc: thenable с `abortSignal`, как построитель запроса supabase-js. */
type Builder = {
  abortSignal: jest.Mock<Builder, [AbortSignal]>;
  then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => unknown;
};

function respond(result: { data: unknown; error: unknown }): Builder {
  const builder: Builder = {
    abortSignal: jest.fn((_signal: AbortSignal): Builder => builder),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  mockedRpc.mockReturnValue(builder);
  return builder;
}

function messageRow(index: number) {
  return {
    message_id: `m${index}`,
    chat_id: 'chat-1',
    chat_kind: 'group',
    channel_id: null,
    chat_title: 'Планы',
    chat_avatar_url: null,
    author_id: 'u1',
    author_name: 'Аня',
    text: `привет ${index}`,
    seq: 1000 - index,
    created_at: `2026-10-13T10:${String(59 - index).padStart(2, '0')}:00Z`,
    fuzzy: false,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('searchEntities', () => {
  it('keeps the order and sections the database ranked', async () => {
    respond({
      data: [
        {
          section: 'mine',
          entity_kind: 'channel',
          id: 'ch1',
          chat_id: 'posts1',
          channel_id: 'ch1',
          peer_id: null,
          title: 'Max news',
          username: 'news',
          avatar_url: null,
          subscribed: true,
          subscribers_count: 12,
        },
        {
          section: 'global',
          entity_kind: 'person',
          id: 'p1',
          chat_id: null,
          channel_id: null,
          peer_id: 'p1',
          title: 'Максим',
          username: 'max',
          avatar_url: 'https://a/b.png',
          subscribed: false,
          subscribers_count: null,
        },
      ],
      error: null,
    });

    const result = await searchEntities('@max');

    expect(mockedRpc).toHaveBeenCalledWith('search_entities', {
      query: '@max',
      mine_limit: expect.any(Number),
      global_limit: expect.any(Number),
    });
    expect(result.map((entity) => [entity.section, entity.kind, entity.title])).toEqual([
      ['mine', 'channel', 'Max news'],
      ['global', 'person', 'Максим'],
    ]);
    expect(result[0]).toMatchObject({ channelId: 'ch1', chatId: 'posts1', subscribed: true });
    expect(result[1]).toMatchObject({ personId: 'p1', username: 'max', subscribed: false });
  });

  it('skips rows of a kind this client does not know', async () => {
    respond({
      data: [{ section: 'global', entity_kind: 'stream', id: 's1', title: 'Эфир' }],
      error: null,
    });

    await expect(searchEntities('эфир')).resolves.toEqual([]);
  });

  it('passes the query signal so a stale request is cancelled', async () => {
    const builder = respond({ data: [], error: null });
    const controller = new AbortController();

    await searchEntities('при', controller.signal);

    expect(builder.abortSignal).toHaveBeenCalledWith(controller.signal);
  });

  it('throws when the server fails', async () => {
    const failure = { code: '500', message: 'boom' };
    respond({ data: null, error: failure });

    await expect(searchEntities('max')).rejects.toBe(failure);
  });
});

describe('searchMessages', () => {
  it('asks for the first page without a cursor', async () => {
    respond({ data: [messageRow(1)], error: null });

    const page = await searchMessages('привет', null);

    expect(mockedRpc).toHaveBeenCalledWith('search_messages', {
      query: 'привет',
      before_seq: undefined,
      page_size: SEARCH_MESSAGES_PAGE_SIZE,
    });
    expect(page.items[0]).toEqual<SearchMessage>({
      id: 'm1',
      chatId: 'chat-1',
      chatKind: 'group',
      channelId: null,
      chatTitle: 'Планы',
      chatAvatarUrl: null,
      authorId: 'u1',
      authorName: 'Аня',
      text: 'привет 1',
      seq: 999,
      createdAt: messageRow(1).created_at,
      fuzzy: false,
    });
    expect(page.nextCursor).toBeNull();
  });

  it('continues after the last row of a full page, by its number', async () => {
    const rows = Array.from({ length: SEARCH_MESSAGES_PAGE_SIZE }, (_, index) => messageRow(index));
    respond({ data: rows, error: null });

    const page = await searchMessages('привет', null);
    const last = rows[rows.length - 1];

    expect(page.nextCursor).toBe(last.seq);

    respond({ data: [], error: null });
    await searchMessages('привет', page.nextCursor);

    expect(mockedRpc).toHaveBeenLastCalledWith('search_messages', {
      query: 'привет',
      before_seq: last.seq,
      page_size: SEARCH_MESSAGES_PAGE_SIZE,
    });
  });

  it('opens a channel post through its channel', async () => {
    respond({
      data: [{ ...messageRow(1), chat_kind: 'channel', channel_id: 'ch1' }],
      error: null,
    });

    const page = await searchMessages('привет', null);

    expect(page.items[0]).toMatchObject({ chatKind: 'channel', channelId: 'ch1' });
  });

  it('shows only what the database returned: other chats are filtered there, not here', async () => {
    // Граница доступа — в `search_messages` (supabase/tests/search_access.sql):
    // сообщения чата без моего участия и подписки база не отдаёт. Клиент не
    // достраивает выдачу сам и не подмешивает ничего сверх ответа.
    respond({ data: [], error: null });

    await expect(searchMessages('чужоеслово', null)).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it('throws when the server fails', async () => {
    const failure = { code: '42501', message: 'denied' };
    respond({ data: null, error: failure });

    await expect(searchMessages('привет', null)).rejects.toBe(failure);
  });
});

function popRow(index: number) {
  return {
    id: `p${index}`,
    channel_id: 'ch-1',
    author_id: 'u1',
    title: index === 0 ? null : `Ёлка ${index}`,
    caption: 'подпись',
    url: 'https://cdn/p.mp4',
    poster_url: 'https://cdn/p.jpg',
    mime_type: 'video/mp4',
    width: 720,
    height: 1280,
    duration_ms: 6000,
    created_at: '2026-10-12T10:00:00Z',
    reactions: { '❤️': 2 },
    views_count: 10,
    comments_count: 1,
    my_reaction: index === 0 ? '❤️' : null,
    channel_title: 'Ёлки',
    channel_avatar_url: null,
    rank: 7,
    score: 0.123456789,
    scored_at: '2026-10-13T10:00:00Z',
  };
}

describe('searchChannels', () => {
  it('asks for all channels and maps the subscription and ownership marks', async () => {
    respond({
      data: [
        {
          id: 'ch-1',
          posts_chat_id: 'posts-1',
          title: 'Ёлки',
          username: 'elki',
          avatar_url: null,
          subscribers_count: 5,
          subscribed: true,
          mine: false,
        },
      ],
      error: null,
    });

    await expect(searchChannels('@elki')).resolves.toEqual([
      {
        id: 'ch-1',
        postsChatId: 'posts-1',
        title: 'Ёлки',
        username: 'elki',
        avatarUrl: null,
        subscribersCount: 5,
        subscribed: true,
        mine: false,
      },
    ]);
    expect(mockedRpc).toHaveBeenCalledWith('search_channels', { query: '@elki', max_count: 50 });
  });
});

describe('searchPops', () => {
  it('the first page goes without a cursor and maps everything the tile and viewer need', async () => {
    respond({ data: [popRow(0)], error: null });

    const [pop] = await searchPops('елка', null);

    expect(mockedRpc).toHaveBeenCalledWith('search_pops', {
      query: 'елка',
      as_of: undefined,
      after_rank: undefined,
      after_score: undefined,
      after_id: undefined,
      page_size: SEARCH_POPS_PAGE_SIZE,
    });
    expect(pop).toMatchObject({
      id: 'p0',
      channelId: 'ch-1',
      title: null,
      caption: 'подпись',
      reactions: { counts: { '❤️': 2 }, mine: '❤️' },
      viewsCount: 10,
      commentsCount: 1,
      channelTitle: 'Ёлки',
      rank: 7,
      score: 0.123456789,
      scoredAt: '2026-10-13T10:00:00Z',
    });
  });

  it('the next page carries the last row and the first page’s moment', async () => {
    respond({ data: [], error: null });

    await searchPops('елка', {
      rank: 5,
      score: 0.25,
      id: 'p29',
      scoredAt: '2026-10-13T10:00:00Z',
    });

    expect(mockedRpc).toHaveBeenCalledWith('search_pops', {
      query: 'елка',
      as_of: '2026-10-13T10:00:00Z',
      after_rank: 5,
      after_score: 0.25,
      after_id: 'p29',
      page_size: SEARCH_POPS_PAGE_SIZE,
    });
  });

  it('a full page has a cursor, a short one does not', async () => {
    respond({
      data: Array.from({ length: SEARCH_POPS_PAGE_SIZE }, (_, i) => popRow(i + 1)),
      error: null,
    });

    const page = await searchPops('елка', null);

    expect(nextSearchPopsCursor(page)).toEqual({
      rank: 7,
      score: 0.123456789,
      id: `p${SEARCH_POPS_PAGE_SIZE}`,
      scoredAt: '2026-10-13T10:00:00Z',
    });
    expect(nextSearchPopsCursor(page.slice(1))).toBeNull();
  });

  it('passes the error on', async () => {
    respond({ data: null, error: new Error('boom') });

    await expect(searchPops('елка', null)).rejects.toThrow('boom');
  });
});
