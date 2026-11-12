import {
  getHistoryChanges,
  getHistoryRange,
  getHistoryWindow,
  getHistoryItems,
  type HistoryWindowRequest,
} from './historyWindow';
import { HISTORY_PAGE_COLUMNS } from './messageRows';
import { supabase } from './supabase';

jest.mock('@/api/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
const message = {
  id: 'group',
  chat_id: 'chat',
  seq: 10,
  kind: 'forward',
  text: null,
  author_id: null,
  created_at: null,
  edited_at: null,
  hidden_ranges: [],
  attachments: [],
  replies: [],
  items: [],
  hidden: false,
};
const element = (position: number) => ({
  id: `item-${position}`,
  message_id: 'group',
  chat_id: 'chat',
  seq: 10,
  position,
  forward_item_id: `item-${position}`,
  message,
  forward_item: { id: `item-${position}`, position, message_id: 'same-original', original: null },
});
function response() {
  return {
    chat_id: 'chat',
    target_status: 'found',
    sync_cursor: 'h1.fixture',
    anchor: { messageId: 'group', itemId: 'item-50', key: 'item-50', seq: 10, position: 50 },
    before_cursor: { chatId: 'chat', direction: 'before', seq: 10, position: 49 },
    after_cursor: { chatId: 'chat', direction: 'after', seq: 10, position: 51 },
    has_before: true,
    has_after: true,
    coverage: {
      lower: { seq: 10, position: 49, inclusive: true },
      upper: { seq: 10, position: 51, inclusive: true },
    },
    parents: [message],
    element_ids: ['item-49', 'item-50', 'item-51'],
    forwards: [51, 49, 50].map((i) => ({ ...element(i).forward_item, forward_id: 'group' })),
  };
}
function mock(data: unknown = response()) {
  const query = {
    select: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data, error: null }),
  };
  jest.mocked(supabase.rpc).mockReturnValue(query as unknown as ReturnType<typeof supabase.rpc>);
  return query;
}
beforeEach(() => jest.clearAllMocks());
it('loads a single snapshot of selected occurrences with distinct item/action/original identities', async () => {
  const query = mock();
  const result = await getHistoryWindow('chat', {
    mode: 'around',
    messageId: 'group',
    itemId: 'item-50',
  });
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  expect(query.select).toHaveBeenCalledWith(HISTORY_PAGE_COLUMNS);
  expect(query.select.mock.calls[0][0]).not.toContain('items:forward_items!');
  expect(result.items.map((item) => item.key)).toEqual(['item-49', 'item-50', 'item-51']);
  expect(result.items[1]).toMatchObject({
    messageId: 'group',
    forwardItemId: 'item-50',
    originalId: 'same-original',
    position: { seq: 10, position: 50 },
  });
  expect(result.items[1].message.forward!.items).toHaveLength(1);
  expect(result.items[1].message.forward!.items[0].original).toBeNull();
  expect(result.coverage?.lower).toEqual({ seq: 10, position: 49, inclusive: true });
});
it('joins by parent even when an ordinary message and a forward item share a UUID', async () => {
  const page = response();
  mock({
    ...page,
    parents: [{ ...message, id: 'item-50', seq: 12, kind: 'text' }, message],
    element_ids: [...page.element_ids, 'item-50'],
  });
  const { items } = await getHistoryWindow('chat');
  expect(items.map((i) => [i.messageId, i.forwardItemId])).toEqual([
    ['group', 'item-49'],
    ['group', 'item-50'],
    ['group', 'item-51'],
    ['item-50', null],
  ]);
});
it.each([
  { chatId: 'other', direction: 'before', seq: 10, position: 1 },
  { chatId: 'chat', direction: 'after', seq: 10, position: 1 },
  { chatId: 'chat', direction: 'before', seq: 10, position: 100.1 },
  { chatId: 'chat', direction: 'before', seq: 10, position: -2 },
  { chatId: 'chat', direction: 'before', seq: Number.MAX_SAFE_INTEGER + 1, position: 1 },
])('rejects invalid cursor before requesting the server: %j', async (cursor) => {
  await expect(
    getHistoryWindow('chat', { mode: 'before', cursor } as HistoryWindowRequest),
  ).rejects.toThrow();
  expect(supabase.rpc).not.toHaveBeenCalled();
});
it('does not claim coverage for an unavailable exact element', async () => {
  mock({
    ...response(),
    target_status: 'unavailable',
    anchor: null,
    before_cursor: null,
    after_cursor: null,
    coverage: null,
    element_ids: [],
    parents: [],
    forwards: [],
  });
  const result = await getHistoryWindow('chat', {
    mode: 'around',
    messageId: 'group',
    itemId: 'removed',
  });
  expect(result.coverage).toBeNull();
  expect(result.syncCursor).toBeNull();
  expect(result.reachedStart).toBeNull();
  expect(result.reachedEnd).toBeNull();
});
it('refreshes within the saved coverage and splits at the last verified coordinate', async () => {
  const page = response();
  mock(page);
  const coverage = { lower: page.coverage.lower, upper: null };
  const piece = await getHistoryRange('chat', coverage, 3);
  expect(supabase.rpc).toHaveBeenCalledWith('get_history_range', {
    p_chat: 'chat',
    p_range: coverage,
    p_limit: 3,
  });
  expect(piece.syncCursor).toBe(page.sync_cursor);
  expect(piece.remaining).toEqual({
    lower: { ...page.coverage.upper, inclusive: false },
    upper: null,
  });
});
it.each([
  { status: 'more', cursor: 'h1.continuation', parentIds: [] },
  { status: 'current', cursor: 'h1.next', parentIds: [] },
  { status: 'reconcile', cursor: null, parentIds: ['parent'] },
  { status: 'expired', cursor: null, parentIds: [] },
])('preserves $status even when there are no visible identifiers', async (page) => {
  jest
    .mocked(supabase.rpc)
    .mockReturnValue(
      Promise.resolve({ data: page, error: null }) as unknown as ReturnType<typeof supabase.rpc>,
    );
  await expect(getHistoryChanges('chat', 'h1.saved', 1)).resolves.toEqual(page);
  expect(supabase.rpc).toHaveBeenCalledWith('get_history_changes', {
    p_chat: 'chat',
    p_cursor: 'h1.saved',
    p_limit: 1,
  });
});
it('rejects oversized point refresh instead of silently truncating', async () => {
  await expect(
    getHistoryItems(
      'chat',
      Array.from({ length: 101 }, (_, i) => `${i}`),
    ),
  ).rejects.toThrow('100');
  expect(supabase.rpc).not.toHaveBeenCalled();
});
