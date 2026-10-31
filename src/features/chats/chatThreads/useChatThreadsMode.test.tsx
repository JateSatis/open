import { act, renderHook } from '@testing-library/react-native';

jest.mock('@/api/chats', () => ({ listChatThreadRootPositions: jest.fn() }));

import type { ChatSummary } from '@/api/chats';
import { useChatThreadsView } from '@/features/chats/chatThreads/useChatThreadsMode';

function group(participantCount: number): ChatSummary {
  return {
    kind: 'group',
    participants: Array.from({ length: participantCount }, (_, index) => ({ id: `user-${index}` })),
  } as unknown as ChatSummary;
}

it('keeps threads selected across a brief incomplete participant refresh, then resets after a confirmed decrease', async () => {
  jest.useFakeTimers();
  const { result, rerender, unmount } = await renderHook(
    ({ chat }: { chat: ChatSummary | null }) => useChatThreadsView(chat),
    { initialProps: { chat: group(3) } },
  );

  await act(async () => result.current.setView('chat-threads'));
  expect(result.current.view).toBe('chat-threads');

  await rerender({ chat: group(2) });
  expect(result.current.view).toBe('chat-threads');
  expect(result.current.available).toBe(true);

  await rerender({ chat: group(3) });
  await act(async () => jest.advanceTimersByTime(600));
  expect(result.current.view).toBe('chat-threads');

  await rerender({ chat: group(2) });
  await act(async () => jest.advanceTimersByTime(600));
  expect(result.current.view).toBe('all');
  expect(result.current.available).toBe(false);

  await rerender({ chat: group(3) });
  expect(result.current.view).toBe('all');
  await unmount();
  jest.useRealTimers();
});
