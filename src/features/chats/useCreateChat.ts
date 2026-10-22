import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { describeContactRefusal } from '@/api/contactErrors';
import { createChat, DuplicateChatError, type CreateChatResult } from '@/api/invites';
import { chatsQueryKey } from '@/features/chats/useChats';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { invitesQueryKey } from '@/features/chats/useInvites';
import { GROUP_AVATAR_DEADLINE_MS } from '@/features/chats/useChangeGroupAvatar';
import { removePublicMedia, uploadGroupAvatar } from '@/features/media';
import { DeadlineError, withDeadline } from '@/lib/deadline';
import { describeLoadError } from '@/lib/network';

export type NewChat = {
  inviteeIds: string[];
  title?: string;
  /**
   * Фото группы — квадратное и сжатое, на устройстве. Берётся, только если
   * получится группа (позвано двое и больше); у диалога своего фото нет.
   */
  avatarUri?: string | null;
};

export type CreateChatProblem =
  { kind: 'duplicate'; chatId: string } | { kind: 'failed'; message: string | null };

export type CreateChatState = {
  isCreating: boolean;
  problem: CreateChatProblem | null;
  create: (input: NewChat) => void;
  /** Убрать сообщение о прошлой попытке: выбор изменился, и оно уже не о нём. */
  dismissProblem: () => void;
};

/**
 * Фото группы загружается первым: группа создаётся сразу с его адресом. Если
 * фото не пригодилось — чат не создан (дубль, сбой) или это встречная заявка в
 * уже существующий чат, — файл убирается из бакета.
 */
async function createWithAvatar(input: NewChat, userId: string | null): Promise<CreateChatResult> {
  const { inviteeIds, title, avatarUri } = input;

  if (!avatarUri || inviteeIds.length < 2) return createChat({ inviteeIds, title });
  if (!userId) throw new Error('Нет активной сессии');

  // Без связи загрузка в Storage не падает, а висит: срок превращает её в
  // понятную ошибку. Файл, доехавший после срока, убирается.
  const avatar = await withDeadline(
    uploadGroupAvatar(avatarUri, userId),
    GROUP_AVATAR_DEADLINE_MS,
    (late) => {
      void removePublicMedia(late.path);
    },
  );
  let result: CreateChatResult;

  try {
    // Без связи запрос висел бы молча, как и загрузка.
    result = await withDeadline(
      createChat({ inviteeIds, title, avatarUrl: avatar.url }),
      GROUP_AVATAR_DEADLINE_MS,
    );
  } catch (error) {
    // Запрос, оборванный по сроку, мог дойти до базы, и файл тогда — фото
    // группы. Лишний файл дешевле битой аватарки.
    if (!(error instanceof DeadlineError)) void removePublicMedia(avatar.path);
    throw error;
  }

  if (result.outcome !== 'created') void removePublicMedia(avatar.path);
  return result;
}

/** Текст отказа создания для человека. */
export function describeCreateChatError(cause: Error): string | null {
  return describeContactRefusal(cause) ?? describeLoadError(cause, 'Не удалось создать чат');
}

/**
 * Создаёт чат и отдаёт id чата, который надо открыть: новый или — при
 * встречной заявке — тот, куда меня уже позвали эти же люди. Один позванный
 * не-друг — чата ещё нет: `onRequest` ведёт к заявке на диалог.
 */
export function useCreateChat(
  onOpen: (chatId: string) => void,
  onRequest?: (userId: string) => void,
): CreateChatState {
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();
  const [problem, setProblem] = useState<CreateChatProblem | null>(null);

  const mutation = useMutation({
    // Без связи React Query поставил бы создание на паузу, и кнопка крутилась
    // бы молча. Создание пробуется сразу и честно падает.
    networkMode: 'always',
    mutationFn: (input: NewChat) => createWithAvatar(input, userId),
    onSuccess: (result, input) => {
      if (result.outcome === 'request_needed') {
        onRequest?.(input.inviteeIds[0]);
        return;
      }

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
          : { kind: 'failed', message: describeCreateChatError(cause) },
      );
    },
  });

  const create = useCallback(
    (input: NewChat) => {
      setProblem(null);
      mutation.mutate(input);
    },
    [mutation],
  );

  const dismissProblem = useCallback(() => setProblem(null), []);

  return { isCreating: mutation.isPending, problem, create, dismissProblem };
}
