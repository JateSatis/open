import { getHistoryWindow, type HistoryWindowRequest } from './historyWindow';
import { MESSAGE_COLUMNS } from './messageRows';
import { supabase } from './supabase';

jest.mock('@/api/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));

const row = (seq: number) => ({
  id: `m${seq}`,
  chat_id: 'chat',
  seq,
  kind: 'text',
  text: `text ${seq}`,
  author_id: 'opaque',
  author_name: 'Shown name',
  author_avatar_url: null,
  author_opaque: true,
  attachments: [],
  hidden_ranges: [],
});
const response = () => ({
  chat_id: 'chat',
  target_status: 'found',
  anchor_id: 'm2',
  anchor_seq: 2,
  before_seq: 1,
  after_seq: 3,
  has_before: true,
  has_after: true,
  lower_seq: 1,
  lower_inclusive: true,
  upper_seq: 3,
  upper_inclusive: true,
  items: [row(1), row(2), row(3)],
});

function mockResponse(data: unknown = response(), error: unknown = null) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data, error }),
  };
  jest.mocked(supabase.rpc).mockReturnValue(builder as unknown as ReturnType<typeof supabase.rpc>);
  return builder;
}
beforeEach(() => jest.clearAllMocks());

it('reads one RPC with complete existing message projection and ascending order', async () => {
  const query = mockResponse();
  const result = await getHistoryWindow('chat', { mode: 'around', messageId: 'm2', savedSeq: 99 });
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  expect(supabase.rpc).toHaveBeenCalledWith('get_history_window', {
    p_chat: 'chat',
    p_mode: 'around',
    p_limit: 30,
    p_target: 'm2',
    p_hint_seq: 99,
    p_cursor: undefined,
  });
  expect(query.select.mock.calls[0][0]).toContain(
    `items:history_window_messages(${MESSAGE_COLUMNS})`,
  );
  expect(query.order).toHaveBeenCalledWith('seq', { referencedTable: 'items', ascending: true });
  expect(result.items.map((x) => x.seq)).toEqual([1, 2, 3]);
  expect(result.items[0]).toMatchObject({
    authorId: 'opaque',
    authorOpaque: true,
    author: { displayName: 'Shown name' },
  });
  expect(result).toMatchObject({
    target: 'found',
    anchor: { messageId: 'm2', seq: 2 },
    before: { chatId: 'chat', direction: 'before', seq: 1 },
    after: { chatId: 'chat', direction: 'after', seq: 3 },
    coverage: { lower: { seq: 1, inclusive: true }, upper: { seq: 3, inclusive: true } },
  });
  expect(supabase.from).not.toHaveBeenCalled();
});

it.each(['before', 'after'] as const)(
  'passes %s cursor unchanged, with no target',
  async (direction) => {
    mockResponse();
    const request: HistoryWindowRequest =
      direction === 'before'
        ? { mode: direction, cursor: { chatId: 'chat', direction, seq: 10 } }
        : { mode: direction, cursor: { chatId: 'chat', direction, seq: 10 } };
    await getHistoryWindow('chat', request);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'get_history_window',
      expect.objectContaining({ p_mode: direction, p_cursor: request.cursor, p_target: undefined }),
    );
  },
);

it('distinguishes unavailable target from checked empty history', async () => {
  const empty = {
    ...response(),
    items: [],
    anchor_id: null,
    anchor_seq: null,
    before_seq: null,
    after_seq: null,
    has_before: false,
    has_after: false,
    lower_seq: null,
    upper_seq: null,
  };
  mockResponse({ ...empty, target_status: 'unavailable' });
  expect(await getHistoryWindow('chat', { mode: 'around', messageId: 'gone' })).toMatchObject({
    items: [],
    target: 'unavailable',
    coverage: null,
    reachedStart: null,
    reachedEnd: null,
  });
  mockResponse({ ...empty, target_status: 'none' });
  expect(await getHistoryWindow('chat')).toMatchObject({
    items: [],
    target: 'none',
    coverage: { lower: null, upper: null },
    reachedStart: true,
    reachedEnd: true,
  });
});

it('does not infer continuation from a full page', async () => {
  mockResponse({
    ...response(),
    before_seq: null,
    after_seq: null,
    has_before: false,
    has_after: false,
  });
  expect(await getHistoryWindow('chat', { mode: 'latest', limit: 3 })).toMatchObject({
    before: null,
    after: null,
    reachedStart: true,
    reachedEnd: true,
  });
});

it.each([0, -1, 101, 1.5, NaN, Infinity])(
  'rejects invalid limit %s before network',
  async (limit) => {
    await expect(getHistoryWindow('chat', { mode: 'latest', limit })).rejects.toThrow();
    expect(supabase.rpc).not.toHaveBeenCalled();
  },
);

it('rejects foreign and unsafe coordinates', async () => {
  await expect(
    getHistoryWindow('chat', {
      mode: 'before',
      cursor: { chatId: 'foreign', direction: 'before', seq: 5 },
    }),
  ).rejects.toThrow();
  await expect(
    getHistoryWindow('chat', {
      mode: 'around',
      messageId: 'm',
      savedSeq: Number.MAX_SAFE_INTEGER + 1,
    }),
  ).rejects.toThrow();
  expect(supabase.rpc).not.toHaveBeenCalled();
});

it('propagates server errors rather than treating them as empty history', async () => {
  const error = { code: '42501', message: 'denied' };
  mockResponse(null, error);
  await expect(getHistoryWindow('chat')).rejects.toBe(error);
});
