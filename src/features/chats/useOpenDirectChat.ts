import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { getOrCreateDirectChat } from '@/api/chats';
import { chatsQueryKey } from '@/features/chats/useChats';

export type OpenDirectChatState = {
  /** Id пользователя, диалог с которым открывается прямо сейчас. */
  pendingUserId: string | null;
  error: string | null;
  open: (userId: string) => void;
};

/**
 * Открывает диалог с человеком, создавая его при первом обращении. Переход
 * происходит только после ответа сервера: иначе экран чата получил бы id,
 * которого ещё нет.
 */
export function useOpenDirectChat(): OpenDirectChatState {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: getOrCreateDirectChat,
    onSuccess: (chatId) => {
      void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
      router.push(`/chats/${chatId}`);
    },
    onError: (cause: Error) => {
      setError(cause.message ?? 'Не удалось открыть диалог');
    },
    onSettled: () => setPendingUserId(null),
  });

  const open = useCallback(
    (userId: string) => {
      setError(null);
      setPendingUserId(userId);
      mutation.mutate(userId);
    },
    [mutation],
  );

  return { pendingUserId, error, open };
}
