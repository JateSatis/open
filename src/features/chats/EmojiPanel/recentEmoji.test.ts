import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';

import { MAX_RECENT_EMOJI, rememberEmoji, useRecentEmoji } from './recentEmoji';

describe('recent emoji', () => {
  it('puts the latest first, lifts a repeat instead of doubling it, and keeps a bounded list', async () => {
    const { result } = await renderHook(() => useRecentEmoji());

    await act(() => {
      rememberEmoji('😀');
      rememberEmoji('🔥');
      rememberEmoji('😀');
    });

    expect(result.current).toEqual(['😀', '🔥']);

    await act(() => {
      for (let i = 0; i < MAX_RECENT_EMOJI + 5; i++) rememberEmoji(String(i));
    });

    expect(result.current).toHaveLength(MAX_RECENT_EMOJI);
    expect(result.current[0]).toBe(String(MAX_RECENT_EMOJI + 4));
  });

  it('is saved to the device storage, so it survives a restart', async () => {
    await act(() => rememberEmoji('🎉'));

    const saved = await AsyncStorage.getItem('open.recent-emoji');

    expect(JSON.parse(saved ?? '{}').state.recent[0]).toBe('🎉');
  });
});
