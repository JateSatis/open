import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { acceptInvite, declineInvite } from '@/api/invites';
import { chatQueryKey } from '@/features/chats/useChat';
import { chatsQueryKey } from '@/features/chats/useChats';
import { invitesQueryKey } from '@/features/chats/useInvites';
import { myInviteQueryKey } from '@/features/chats/useMyInvite';
import { describeLoadError } from '@/lib/network';

export type InviteAnswer = 'accept' | 'decline';

export type RespondToInviteState = {
  /** Чат, на заявку в который ответ уходит прямо сейчас. */
  pendingChatId: string | null;
  error: string | null;
  respond: (chatId: string, answer: InviteAnswer) => void;
};

/**
 * Ответ на заявку. Ждёт сервера, а не рисует результат заранее: принятие
 * меняет, может ли человек писать, и врать об этом нельзя.
 */
export function useRespondToInvite(): RespondToInviteState {
  const queryClient = useQueryClient();
  const [pendingChatId, setPendingChatId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: ({ chatId, answer }: { chatId: string; answer: InviteAnswer }) =>
      answer === 'accept' ? acceptInvite(chatId) : declineInvite(chatId),
    onSuccess: (_result, { chatId }) => {
      void queryClient.invalidateQueries({ queryKey: invitesQueryKey });
      void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
      void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId) });
      void queryClient.invalidateQueries({ queryKey: myInviteQueryKey(chatId) });
    },
    onError: (cause: Error, { answer }) => {
      setError(
        describeLoadError(
          cause,
          answer === 'accept' ? 'Не удалось принять заявку' : 'Не удалось отклонить заявку',
        ),
      );
    },
    onSettled: () => setPendingChatId(null),
  });

  const respond = useCallback(
    (chatId: string, answer: InviteAnswer) => {
      setError(null);
      setPendingChatId(chatId);
      mutation.mutate({ chatId, answer });
    },
    [mutation],
  );

  return { pendingChatId, error, respond };
}
