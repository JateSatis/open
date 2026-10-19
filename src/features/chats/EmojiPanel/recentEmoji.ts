import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// «Недавние» панели эмодзи — чисто клиентское состояние: на сервер не уходит
// и переживает перезапуск приложения в AsyncStorage.

/** Сколько недавних помнить: четыре ряда панели с запасом. */
export const MAX_RECENT_EMOJI = 32;

type RecentEmojiState = { recent: string[] };

const useRecentEmojiStore = create<RecentEmojiState>()(
  persist(() => ({ recent: [] as string[] }), {
    name: 'open.recent-emoji',
    storage: createJSONStorage(() => AsyncStorage),
  }),
);

/** Последний выбранный — первым; повтор поднимается наверх, а не дублируется. */
export function rememberEmoji(emoji: string) {
  useRecentEmojiStore.setState((state) => ({
    recent: [emoji, ...state.recent.filter((item) => item !== emoji)].slice(0, MAX_RECENT_EMOJI),
  }));
}

export function useRecentEmoji(): string[] {
  return useRecentEmojiStore((state) => state.recent);
}
