import { act, renderHook } from '@testing-library/react-native';
import { toChatRows, type ChatListRow } from '@/features/chats/islands/rows';
import { island, original } from '@/test/islands';
import { useAttachedHistoryRows } from './useAttachedHistoryRows';
const listeners = new Map<string, (event: { data: { closing: boolean } }) => void>();
const mockNavigation = {
  addListener: jest.fn(
    (name: string, listener: (event: { data: { closing: boolean } }) => void) => {
      listeners.set(name, listener);
      return () => {
        listeners.delete(name);
      };
    },
  ),
};
jest.mock('expo-router', () => ({ useNavigation: () => mockNavigation }));
const rows = (name: string) =>
  toChatRows([
    { ...island(name, '2026-11-10T12:00:00Z', [original({ id: 'original' })]), status: 'sent' },
  ]);
it('applies hidden prepends only after native appearance and keeps ordinary hidden-section updates', async () => {
  const initial = rows('first'),
    newer = [...rows('new'), ...initial];
  const { result, rerender } = await renderHook<ChatListRow[], { items: ChatListRow[]; scope: string }>(
    ({ items, scope }) => useAttachedHistoryRows(items, scope),
    { initialProps: { items: initial, scope: 'chat/all' } },
  );
  expect(result.current).toBe(initial);
  // Changing a channel section does not detach its native stack route.
  await rerender({ items: newer, scope: 'chat/all' });
  expect(result.current).toBe(newer);
  await act(() => listeners.get('transitionStart')!({ data: { closing: true } }));
  const latest = [...rows('last'), ...newer];
  await rerender({ items: latest, scope: 'chat/all' });
  expect(result.current).toBe(newer);
  await act(() => listeners.get('transitionEnd')!({ data: { closing: true } }));
  expect(result.current).toBe(newer);
  await act(() => listeners.get('transitionEnd')!({ data: { closing: false } }));
  expect(result.current).toBe(latest);
  await act(() => listeners.get('transitionStart')!({ data: { closing: true } }));
  await rerender({ items: initial, scope: 'other/all' });
  expect(result.current).toBe(initial);
});
