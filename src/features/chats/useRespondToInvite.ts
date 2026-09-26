import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { acceptInvite, declineInvite } from '@/api/invites';
import { chatQueryKey } from '@/features/chats/useChat';
import { chatsQueryKey } from '@/features/chats/useChats';
import { invitesQueryKey } from '@/features/chats/useInvites';
import { myInviteQueryKey } from '@/features/chats/useMyInvite';
import { describeLoadError } from '@/lib/network';

export type InviteAnswer = 'accept' | 'decline';

export type PendingAnswer = { chatId: string; answer: InviteAnswer };

export type RespondToInviteState = {
  /** Ответ, который уходит прямо сейчас: какая кнопка крутится. */
  pending: PendingAnswer | null;
  error: string | null;
  respond: (chatId: string, answer: InviteAnswer) => void;
};

/**
 * Ответ на заявку. Ждёт сервера, а не рисует результат заранее: принятие
 * меняет, может ли человек писать, и врать об этом нельзя.
 */
export function useRespondToInvite(): RespondToInviteState {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: ({ chatId, answer }: { chatId: string; answer: InviteAnswer }) =>
      answer === 'accept' ? acceptInvite(chatId) : declineInvite(chatId),
    // Мутация остаётся «в процессе», пока списки не перечитаны: кнопка
    // крутится до того самого момента, когда карточка переезжает, а не гаснет
    // на секунды раньше, оставляя человека гадать, сработало ли нажатие.
    onSuccess: (_result, { chatId }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: invitesQueryKey }),
        queryClient.invalidateQueries({ queryKey: chatsQueryKey }),
        queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId) }),
        queryClient.invalidateQueries({ queryKey: myInviteQueryKey(chatId) }),
      ]),
    onError: (cause: Error, { answer }) => {
      setError(
        describeLoadError(
          cause,
          answer === 'accept' ? 'Не удалось принять заявку' : 'Не удалось отклонить заявку',
        ),
      );
    },
    onSettled: () => setPending(null),
  });

  const respond = useCallback(
    (chatId: string, answer: InviteAnswer) => {
      setError(null);
      setPending({ chatId, answer });
      mutation.mutate({ chatId, answer });
    },
    [mutation],
  );

  return { pending, error, respond };
}
