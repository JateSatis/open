import { useEffect, useState } from 'react';

import { getChat, type ChatSummary } from '@/api/chats';

export type ChatState = {
  chat: ChatSummary | null;
  isLoading: boolean;
  error: string | null;
};

export function useChat(chatId: string): ChatState {
  const [chat, setChat] = useState<ChatSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setIsLoading(true);

      try {
        const loaded = await getChat(chatId);

        if (!active) return;

        setChat(loaded);
        setError(null);
      } catch (cause) {
        if (!active) return;

        setError(cause instanceof Error ? cause.message : 'Не удалось открыть чат');
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [chatId]);

  return { chat, isLoading, error };
}
