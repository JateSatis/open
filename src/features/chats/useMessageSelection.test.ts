import { act, renderHook } from '@testing-library/react-native';

import { useMessageSelection } from './useMessageSelection';

import type { Message } from '@/api/chats';
import { toChatRows, type ChatListRow } from '@/features/chats/islands/rows';
import type { ChatMessage } from '@/features/chats/messages/types';
import { island, original } from '@/test/islands';

function message(id: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    chatId: 'chat-1',
    authorId: 'user-1',
    kind: 'text',
    text: id,
    createdAt: `2026-09-27T10:0${id.length}:00Z`,
    editedAt: null,
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

const rowsOf = (messages: ChatMessage[]) => toChatRows(messages);
const sent = (item: Message): ChatMessage => ({ ...item, status: 'sent' });
const keysOf = (rows: { key: string }[]) => rows.map((row) => row.key);

// Список новыми вперёд, как его отдаёт переписка.
const newestFirst = rowsOf([message('c'), message('b'), message('a')]);

describe('useMessageSelection', () => {
  it('turns selection mode on with the first mark and off with the last', async () => {
    const { result } = await renderHook(() => useMessageSelection(newestFirst, 'user-1'));

    expect(result.current.isActive).toBe(false);

    await act(() => result.current.start('b'));
    expect(result.current.isActive).toBe(true);

    await act(() => result.current.toggle('b'));
    expect(result.current.isActive).toBe(false);
  });

  it('keeps the selected messages in chat order', async () => {
    const { result } = await renderHook(() => useMessageSelection(newestFirst, 'user-1'));

    await act(() => result.current.start('c'));
    await act(() => result.current.toggle('a'));

    expect(keysOf(result.current.selected)).toEqual(['a', 'c']);
  });

  it('survives newly arrived and older loaded messages', async () => {
    const { result, rerender } = await renderHook(
      ({ rows }: { rows: ChatListRow[] }) => useMessageSelection(rows, 'user-1'),
      { initialProps: { rows: newestFirst } },
    );

    await act(() => result.current.start('b'));
    await rerender({ rows: rowsOf([message('d'), message('c'), message('b'), message('a'), message('0')]) });

    expect(keysOf(result.current.selected)).toEqual(['b']);
  });

  it('quietly drops a selected message that got deleted', async () => {
    const { result, rerender } = await renderHook(
      ({ rows }: { rows: ChatListRow[] }) => useMessageSelection(rows, 'user-1'),
      { initialProps: { rows: newestFirst } },
    );

    await act(() => result.current.start('b'));
    await act(() => result.current.toggle('c'));
    await rerender({ rows: rowsOf([message('c'), message('a')]) });

    expect(keysOf(result.current.selected)).toEqual(['c']);

    await rerender({ rows: rowsOf([message('a')]) });

    expect(result.current.isActive).toBe(false);
  });

  it('does not let an unsent message into the selection', async () => {
    const rows = rowsOf([
      message('local-1', { status: 'failed', localId: 'local-1' }),
      message('c'),
      message('b'),
      message('a'),
    ]);
    const { result } = await renderHook(() => useMessageSelection(rows, 'user-1'));

    await act(() => result.current.start('a'));
    await act(() => result.current.toggle('local-1'));

    expect(keysOf(result.current.selected)).toEqual(['a']);
  });

  it('selects bubbles of an island one by one, in the order they stand on screen', async () => {
    // Сверху вниз: «a», островок (o2 старше o1, но стоит ниже), «z».
    const rows = rowsOf([
      message('z', { createdAt: '2026-09-27T12:00:00Z' }),
      sent(
        island('isl', '2026-09-27T11:00:00Z', [
          original({ id: 'o1', createdAt: '2026-09-01T10:00:00Z' }),
          original({ id: 'o2', createdAt: '2026-08-01T10:00:00Z' }),
        ]),
      ),
      message('a', { createdAt: '2026-09-27T10:00:00Z' }),
    ]);
    const { result } = await renderHook(() => useMessageSelection(rows, 'user-1'));

    await act(() => result.current.start('z'));
    await act(() => result.current.toggle('isl/o2'));
    await act(() => result.current.toggle('isl/o1'));
    // Плашку островка не выбрать: это не сообщение.
    await act(() => result.current.toggle('isl/header'));

    expect(keysOf(result.current.selected)).toEqual(['isl/o1', 'isl/o2', 'z']);
  });

  it('lets only the forwarder select the stub of a deleted original', async () => {
    const rows = rowsOf([sent(island('isl', '2026-09-27T11:00:00Z', [null], { authorId: 'user-2' }))]);
    const mine = await renderHook(() => useMessageSelection(rows, 'user-2'));
    const theirs = await renderHook(() => useMessageSelection(rows, 'user-1'));

    await act(() => mine.result.current.start('x'));
    await act(() => mine.result.current.toggle('isl/deleted-0'));
    await act(() => theirs.result.current.start('x'));
    await act(() => theirs.result.current.toggle('isl/deleted-0'));

    expect(keysOf(mine.result.current.selected)).toEqual(['isl/deleted-0']);
    expect(theirs.result.current.selected).toEqual([]);
  });
});
