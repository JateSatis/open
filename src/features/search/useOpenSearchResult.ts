import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { addRecentSearch, type RecentSearch } from '@/features/search/recentSearches';

/** Открывает найденный чат, канал или профиль и запоминает его в недавних. */
export function useOpenSearchResult(): (item: Extract<RecentSearch, { type: 'entity' }>) => void {
  const router = useRouter();

  return useCallback(
    (item: Extract<RecentSearch, { type: 'entity' }>) => {
      addRecentSearch(item);

      const { entity } = item;

      if (entity.kind === 'person') {
        router.push({ pathname: '/chats/people/[userId]', params: { userId: entity.id } });
      } else if (entity.kind === 'channel' && entity.channelId) {
        router.push({
          pathname: '/chats/channel/[channelId]',
          params: { channelId: entity.channelId },
        });
      } else if (entity.chatId) {
        router.push({
          pathname: '/chats/[chatId]',
          params: { chatId: entity.chatId, from: 'search' },
        });
      }
    },
    [router],
  );
}
