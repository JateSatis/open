import { useCallback, useEffect, useState } from 'react';

import { listChats, type ChatSummary } from '@/api/chats';

export type ChatsState = {
  chats: ChatSummary[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  refresh: () => void;
};

export function useChats(): ChatsState {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const loaded = await listChats();

        if (!active) return;

        setChats(loaded);
        setError(null);
      } catch (cause) {
        if (!active) return;

        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить чаты');
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, []);

  const refresh = useCallback(() => {
    setIsRefreshing(true);

    listChats()
      .then((loaded) => {
        setChats(loaded);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить чаты');
      })
      .finally(() => setIsRefreshing(false));
  }, []);

  return { chats, isLoading, isRefreshing, error, refresh };
}
