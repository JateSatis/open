import { act, renderHook } from '@testing-library/react-native';

import { useMessageSelection } from './useMessageSelection';

import type { ChatMessage } from '@/features/chats/messages/types';

function message(id: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    chatId: 'chat-1',
    authorId: 'user-1',
    kind: 'text',
    text: id,
    createdAt: `2026-09-27T10:0${id.length}:00Z`,
    attachments: [],
    replies: [],
    forward: null,
    status: 'sent',
    ...overrides,
  };
}

// Список новыми вперёд, как его отдаёт переписка.
const newestFirst = [message('c'), message('b'), message('a')];

describe('useMessageSelection', () => {
  it('turns selection mode on with the first mark and off with the last', async () => {
    const { result } = await renderHook(() => useMessageSelection(newestFirst));

    expect(result.current.isActive).toBe(false);

    await act(() => result.current.start('b'));
    expect(result.current.isActive).toBe(true);

    await act(() => result.current.toggle('b'));
    expect(result.current.isActive).toBe(false);
  });

  it('keeps the selected messages in chat order', async () => {
    const { result } = await renderHook(() => useMessageSelection(newestFirst));

    await act(() => result.current.start('c'));
    await act(() => result.current.toggle('a'));

    expect(result.current.selected.map((m) => m.id)).toEqual(['a', 'c']);
  });

  it('survives newly arrived and older loaded messages', async () => {
    const { result, rerender } = await renderHook(
      ({ messages }: { messages: ChatMessage[] }) => useMessageSelection(messages),
      { initialProps: { messages: newestFirst } },
    );

    await act(() => result.current.start('b'));
    await rerender({ messages: [message('d'), ...newestFirst, message('0')] });

    expect(result.current.selected.map((m) => m.id)).toEqual(['b']);
  });

  it('quietly drops a selected message that got deleted', async () => {
    const { result, rerender } = await renderHook(
      ({ messages }: { messages: ChatMessage[] }) => useMessageSelection(messages),
      { initialProps: { messages: newestFirst } },
    );

    await act(() => result.current.start('b'));
    await act(() => result.current.toggle('c'));
    await rerender({ messages: [message('c'), message('a')] });

    expect(result.current.selected.map((m) => m.id)).toEqual(['c']);

    await rerender({ messages: [message('a')] });

    expect(result.current.isActive).toBe(false);
  });

  it('does not let an unsent message into the selection', async () => {
    const messages = [message('local-1', { status: 'failed', localId: 'local-1' }), ...newestFirst];
    const { result } = await renderHook(() => useMessageSelection(messages));

    await act(() => result.current.start('a'));
    await act(() => result.current.toggle('local-1'));

    expect(result.current.selected.map((m) => m.id)).toEqual(['a']);
  });
});
