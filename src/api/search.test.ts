import {
  SEARCH_MESSAGES_PAGE_SIZE,
  searchEntities,
  searchMessages,
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
    abortSignal: jest.fn((): Builder => builder),
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
      before_created: undefined,
      before_id: undefined,
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
      createdAt: messageRow(1).created_at,
      fuzzy: false,
    });
    expect(page.nextCursor).toBeNull();
  });

  it('continues after the last row of a full page, by time and id', async () => {
    const rows = Array.from({ length: SEARCH_MESSAGES_PAGE_SIZE }, (_, index) => messageRow(index));
    respond({ data: rows, error: null });

    const page = await searchMessages('привет', null);
    const last = rows[rows.length - 1];

    expect(page.nextCursor).toEqual({ createdAt: last.created_at, id: last.message_id });

    respond({ data: [], error: null });
    await searchMessages('привет', page.nextCursor);

    expect(mockedRpc).toHaveBeenLastCalledWith('search_messages', {
      query: 'привет',
      before_created: last.created_at,
      before_id: last.message_id,
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
