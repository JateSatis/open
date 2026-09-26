import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { createChat, DuplicateChatError, type CreateChatInput } from '@/api/invites';
import { chatsQueryKey } from '@/features/chats/useChats';
import { invitesQueryKey } from '@/features/chats/useInvites';
import { describeLoadError } from '@/lib/network';

export type CreateChatProblem =
  { kind: 'duplicate'; chatId: string } | { kind: 'failed'; message: string | null };

export type CreateChatState = {
  isCreating: boolean;
  problem: CreateChatProblem | null;
  create: (input: CreateChatInput) => void;
  /** Убрать сообщение о прошлой попытке: выбор изменился, и оно уже не о нём. */
  dismissProblem: () => void;
};

/**
 * Создаёт чат и отдаёт id чата, который надо открыть: новый или — при
 * встречной заявке — тот, куда меня уже позвали эти же люди.
 */
export function useCreateChat(onOpen: (chatId: string) => void): CreateChatState {
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<CreateChatProblem | null>(null);

  const mutation = useMutation({
    mutationFn: createChat,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: chatsQueryKey });

      if (result.outcome === 'incoming_invite') {
        void queryClient.invalidateQueries({ queryKey: invitesQueryKey });
      }

      onOpen(result.chatId);
    },
    onError: (cause: Error) => {
      setProblem(
        cause instanceof DuplicateChatError
          ? { kind: 'duplicate', chatId: cause.chatId }
          : { kind: 'failed', message: describeLoadError(cause, 'Не удалось создать чат') },
      );
    },
  });

  const create = useCallback(
    (input: CreateChatInput) => {
      setProblem(null);
      mutation.mutate(input);
    },
    [mutation],
  );

  const dismissProblem = useCallback(() => setProblem(null), []);

  return { isCreating: mutation.isPending, problem, create, dismissProblem };
}
