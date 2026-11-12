import { QueryClient } from '@tanstack/react-query';
import {
  getHistoryGroupKeys,
  getHistoryItems,
  getHistoryWindow,
  type HistoryWindow,
} from '@/api/historyWindow';
import { island, original } from '@/test/islands';
import { historyFixtureItems } from '@/test/historyWindowMock';
import { toChatRows, rowRenderKey } from '@/features/chats/islands/rows';
import { mergeMessages, messagesQueryKey, readHistory, type ChatHistory } from './historyCache';
import { patchForwardSlices, readForwardSlices } from './forwardSlices';
import { pullNewMessages, refreshIsland } from './sync';

jest.mock('@/api/historyWindow', () => ({
  getHistoryWindow: jest.fn(),
  getHistoryGroupKeys: jest.fn(() => Promise.resolve([])),
  getHistoryItems: jest.fn(),
}));
jest.mock('@/api/chats', () => ({ MESSAGE_PAGE_SIZE: 30 }));
jest.mock('@/api/messageViews', () => ({}));
jest.mock('@/api/reactions', () => ({}));

const group = island(
  'group',
  '2026-11-10T12:00:00Z',
  Array.from({ length: 100 }, (_, i) => original({ id: `original-${i}` })),
);
const fragment = (start: number, end: number) => ({
  ...group,
  forward: { ...group.forward!, items: group.forward!.items.slice(start, end) },
});
const history = (start: number, end: number): ChatHistory =>
  mergeMessages({ items: [], nextCursor: null }, [fragment(start, end)], 'older');
const window = (start: number, end: number): HistoryWindow => ({
  items: historyFixtureItems([fragment(start, end)]),
  target: 'none',
  anchor: null,
  before: start ? { chatId: 'chat-1', direction: 'before', seq: group.seq, position: start } : null,
  after:
    end < 100 ? { chatId: 'chat-1', direction: 'after', seq: group.seq, position: end - 1 } : null,
  coverage: { lower: { seq: group.seq, position: start, inclusive: true }, upper: null },
  syncCursor: 'h1.fixture',
  reachedStart: start === 0,
  reachedEnd: end === 100,
});
beforeEach(() => jest.clearAllMocks());

it('joins pages inside a group with one header, unchanged existing row keys, no duplicates', () => {
  const initial = history(70, 100);
  const keys = toChatRows(initial.items).map((row) => row.key);
  const page = window(40, 70);
  const next = mergeMessages(
    initial,
    page.items.map((item) => item.message),
    'older',
  );
  expect(next.items).toHaveLength(1);
  expect(next.items[0].forward!.items.map((item) => item.position)).toEqual(
    Array.from({ length: 60 }, (_, i) => i + 40),
  );
  const rows = toChatRows(next.items);
  expect(rows.filter((row) => row.type === 'island-header')).toHaveLength(1);
  expect(keys.every((key) => rows.some((row) => row.key === key))).toBe(true);
  expect(
    mergeMessages(
      next,
      page.items.map((item) => item.message),
      'older',
    ),
  ).toBe(next);
});

it('keeps different occurrences of the same original in separate groups', () => {
  const second = island('second', '2026-11-10T12:01:00Z', [original({ id: 'original-70' })]);
  const next = mergeMessages(history(70, 71), [second], 'newer');
  const rows = toChatRows(next.items).filter((row) => row.type === 'island-item');
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((row) => row.key)).size).toBe(2);
});

it('retains the inside-group cursor when the first realtime send fills an empty chat', async () => {
  const client = new QueryClient();
  client.setQueryData(messagesQueryKey('chat-1'), { items: [], nextCursor: null });
  jest.mocked(getHistoryWindow).mockResolvedValue(window(70, 100));
  const incoming = await pullNewMessages(client, 'chat-1');
  expect(incoming).toHaveLength(1);
  expect(readHistory(client, 'chat-1')?.nextCursor).toEqual(window(70, 100).before);
  await pullNewMessages(client, 'chat-1');
  expect(getHistoryWindow).toHaveBeenLastCalledWith(
    'chat-1',
    expect.objectContaining({
      mode: 'after',
      cursor: expect.objectContaining({ seq: group.seq, position: 99 }),
    }),
  );
  client.clear();
});

it('refreshes only loaded occurrence IDs and keeps neighbours added during the request', async () => {
  const client = new QueryClient();
  client.setQueryData(messagesQueryKey('chat-1'), history(70, 100));
  let complete!: (value: Awaited<ReturnType<typeof getHistoryItems>>) => void;
  jest.mocked(getHistoryItems).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const pending = refreshIsland(client, 'chat-1', 'group');
  await Promise.resolve();
  expect(getHistoryItems).toHaveBeenCalledWith('chat-1', [
    'group',
    ...group.forward!.items.slice(70).map((item) => item.id),
  ]);
  client.setQueryData(
    messagesQueryKey('chat-1'),
    mergeMessages(readHistory(client, 'chat-1')!, [fragment(40, 70)], 'older'),
  );
  complete(historyFixtureItems([fragment(71, 100)]));
  await pending;
  const items = readHistory(client, 'chat-1')!.items[0].forward!.items;
  expect(items).toHaveLength(59);
  expect(items[0].position).toBe(40);
  expect(items.some((item) => item.position === 70)).toBe(false);
  client.clear();
});

it('retains occurrence identities, but no content, while a group is hidden', async () => {
  const initial = history(70, 100);
  const hidden = {
    ...group,
    kind: 'text' as const,
    forward: null,
    forwardGroup: true,
    hidden: true,
  };
  const result = patchForwardSlices(initial, {
    requested: new Set(['group']),
    messages: [{ ...hidden, status: 'sent' }],
  });
  expect(result.items[0].forward).toBeNull();
  expect(result.items[0].forwardItemKeys).toHaveLength(30);
  jest.mocked(getHistoryItems).mockResolvedValue(historyFixtureItems([fragment(70, 100)]));
  const fresh = await readForwardSlices(result.items);
  const restored = patchForwardSlices(result, fresh);
  expect(restored.items[0].forward!.items).toHaveLength(30);
});

it.each(['hidden', 'empty'])(
  'restores a previously %s group between loaded neighbours using bounded pages',
  async (state) => {
    const placeholder =
      state === 'hidden'
        ? { ...group, kind: 'text' as const, forward: null, forwardGroup: true, hidden: true }
        : fragment(0, 0);
    const initial = mergeMessages(
      { items: [], nextCursor: null },
      [
        original({ id: 'newer', seq: group.seq + 1 }),
        placeholder,
        original({ id: 'older', seq: group.seq - 1 }),
      ],
      'older',
    );
    jest
      .mocked(getHistoryGroupKeys)
      .mockResolvedValue(
        group.forward!.items.map((item) => ({ key: item.id, position: item.position })),
      );
    jest
      .mocked(getHistoryItems)
      .mockImplementation(async (_chat, keys) =>
        historyFixtureItems([group]).filter((item) => keys.includes(item.key)),
      );
    const restored = patchForwardSlices(initial, await readForwardSlices(initial.items));
    expect(restored.items.map((message) => message.id)).toEqual(['newer', 'group', 'older']);
    expect(restored.items[1].forward!.items).toHaveLength(100);
    expect(getHistoryItems).toHaveBeenCalledTimes(2);
  },
);

it('catches up more than five element pages without discarding an older page loaded concurrently', async () => {
  const client = new QueryClient();
  client.setQueryData(messagesQueryKey('chat-1'), history(70, 100));
  const messages = Array.from({ length: 180 }, (_, i) =>
    original({ id: `new-${i}`, chatId: 'chat-1', seq: group.seq + i + 1 }),
  );
  let finish!: (value: HistoryWindow) => void;
  jest.mocked(getHistoryWindow).mockImplementation(async (_chat, request = { mode: 'latest' }) => {
    const offset = request.cursor!.seq - group.seq;
    const part = messages.slice(offset, offset + 30);
    const result = {
      ...window(0, 100),
      items: historyFixtureItems(part),
      after:
        offset + 30 < 180
          ? { chatId: 'chat-1', direction: 'after' as const, seq: part.at(-1)!.seq, position: 0 }
          : null,
    };
    if (offset === 0)
      return new Promise((resolve) => {
        finish = resolve;
      });
    return result;
  });
  const pending = pullNewMessages(client, 'chat-1');
  client.setQueryData(
    messagesQueryKey('chat-1'),
    mergeMessages(readHistory(client, 'chat-1')!, [fragment(40, 70)], 'older'),
  );
  finish({
    ...window(0, 100),
    items: historyFixtureItems(messages.slice(0, 30)),
    after: { chatId: 'chat-1', direction: 'after', seq: messages[29].seq, position: 0 },
  });
  await pending;
  const result = readHistory(client, 'chat-1')!;
  expect(result.items).toHaveLength(181);
  expect(result.items.at(-1)!.forward!.items).toHaveLength(60);
  expect(getHistoryWindow).toHaveBeenCalledTimes(6);
  client.clear();
});

it('discovers newly visible gaps only inside the verified slice, not the entire group', async () => {
  const initialGroup = fragment(40, 70);
  initialGroup.forward!.items = initialGroup.forward!.items.filter((item) => item.position !== 50);
  const initial = mergeMessages(
    { items: [], nextCursor: null },
    [{ ...initialGroup, forwardRange: { start: 40, end: 69 } }],
    'older',
  );
  jest
    .mocked(getHistoryGroupKeys)
    .mockResolvedValue(
      group.forward!.items.map((item) => ({ key: item.id, position: item.position })),
    );
  jest
    .mocked(getHistoryItems)
    .mockImplementation(async (_chat, keys) =>
      historyFixtureItems([group]).filter((item) => keys.includes(item.key)),
    );
  const result = patchForwardSlices(initial, await readForwardSlices(initial.items));
  expect(result.items[0].forward!.items.map((item) => item.position)).toEqual(
    Array.from({ length: 30 }, (_, i) => i + 40),
  );
  expect(getHistoryItems).toHaveBeenCalledWith('chat-1', expect.arrayContaining(['group-item-50']));
  expect(jest.mocked(getHistoryItems).mock.calls.flatMap((call) => call[1])).not.toContain(
    'group-item-39',
  );
  expect(jest.mocked(getHistoryItems).mock.calls.flatMap((call) => call[1])).not.toContain(
    'group-item-70',
  );
});

it('keeps each cache slice when the refresh combines multiple caches of one group', async () => {
  const narrow = mergeMessages(
    { items: [], nextCursor: null },
    [{ ...fragment(70, 100), forwardRange: { start: 70, end: 99 } }],
    'older',
  );
  const full = mergeMessages(
    { items: [], nextCursor: null },
    [{ ...group, forwardRange: { start: 0, end: 99 } }],
    'older',
  );
  jest
    .mocked(getHistoryGroupKeys)
    .mockResolvedValue(
      group.forward!.items.map((item) => ({ key: item.id, position: item.position })),
    );
  jest
    .mocked(getHistoryItems)
    .mockImplementation(async (_chat, keys) =>
      historyFixtureItems([group]).filter((item) => keys.includes(item.key)),
    );
  const fresh = await readForwardSlices([...narrow.items, ...full.items]);
  expect(patchForwardSlices(narrow, fresh).items[0].forward!.items).toHaveLength(30);
  expect(patchForwardSlices(full, fresh).items[0].forward!.items).toHaveLength(100);
});

it('keeps forward mount keys on confirmation while actions use the server identity', () => {
  const local = { ...group, id: 'local-send', localId: 'local-send', status: 'sending' as const };
  const confirmed = {
    ...group,
    id: 'server-send',
    renderId: 'local-send',
    status: 'sent' as const,
  };
  const before = toChatRows([local]);
  const after = toChatRows([confirmed]);
  expect(after.map(rowRenderKey)).toEqual(before.map(rowRenderKey));
  expect(after.every((row) => row.key.startsWith('server-send/'))).toBe(true);
});
