import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { ChatSummary } from '@/api/chats';
import { fetchSourceChats, type SavedMessage } from '@/api/saved';
import { savedSourceChatsQueryKey } from '@/features/saved/keys';

const NO_CHATS = new Map<string, ChatSummary>();

/** Чаты-источники загруженного сохранённого — живые, одним запросом. */
export function useSavedSourceChats(items: SavedMessage[]): ReadonlyMap<string, ChatSummary> {
  const chatIds = useMemo(
    () => [...new Set(items.flatMap((item) => (item.sourceChatId ? [item.sourceChatId] : [])))],
    [items],
  );
  const chats = useQuery({
    queryKey: savedSourceChatsQueryKey(chatIds),
    queryFn: () => fetchSourceChats(chatIds),
    enabled: chatIds.length > 0,
    placeholderData: (previous) => previous,
  });

  return chats.data ?? NO_CHATS;
}
