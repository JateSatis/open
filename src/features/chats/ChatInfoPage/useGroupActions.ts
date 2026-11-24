import { requestClient } from '@/api/requestClient';
import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@/navigation';
import { useCallback } from 'react';

import type { ChatSummary, Person } from '@/api/chats';
import { cancelChatInvite, deleteDirectChat, leaveChat, removeChatMember } from '@/api/groups';
import { confirm } from '@/components/ConfirmDialog/store';
import { chatsQueryKey } from '@/features/chats/chatsKey';
import { chatQueryKey } from '@/features/chats/useChat';
import { showNotice } from '@/features/notifications/alertsStore';
import { leaveCall } from '@/features/streams/callSession';
import { getCall } from '@/features/streams/callStore';
import { withDeadline } from '@/lib/deadline';
import { isNetworkError } from '@/lib/network';

/** Дольше действие с составом не ждём — дальше это потеря связи. */
const ACTION_DEADLINE_MS = 20_000;

/**
 * Что сказать перед выходом. Владельцу — кому перейдёт группа: самому
 * давнему из остальных (участники приходят по порядку вступления, так же
 * выбирает и база).
 */
export function leaveMessage(chat: ChatSummary, currentUserId: string | null): string {
  const others = chat.participants.filter((person) => person.id !== currentUserId);

  if (others.length === 0) return 'Вы последний участник: писать в группу больше будет некому.';

  if (chat.ownerId === currentUserId) return `Группа перейдёт к ${others[0].displayName}.`;

  return 'Группа уйдёт из «Чатов». Вернуться можно, только если позовут снова.';
}

function failure(action: string, error: unknown) {
  showNotice(
    isNetworkError(error) ? 'Нет связи. Попробуйте ещё раз.' : `Не удалось ${action}`,
    'error',
  );
}

export type GroupActions = {
  leave: () => Promise<void>;
  deleteDialog: () => Promise<void>;
  removeMember: (person: Person) => Promise<void>;
  cancelInvite: (person: Person) => Promise<void>;
};

/**
 * Действия с составом со страницы чата: выйти, удалить диалог, удалить
 * участника, отменить приглашение. Каждое — после подтверждения; права
 * проверяет база.
 */
export function useGroupActions(chat: ChatSummary, currentUserId: string | null): GroupActions {
  const api = useRequestClient();
  const router = useRouter();
  const queryClient = useQueryClient();
  const chatId = chat.id;

  // Чат ушёл из моего списка — сразу, не дожидаясь перечитывания.
  const dropFromList = useCallback(() => {
    queryClient.setQueryData<ChatSummary[]>(chatsQueryKey, (list) =>
      list?.filter((item) => item.id !== chatId),
    );
    void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
    void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId) });
    router.navigate({ name: 'Tabs', params: { screen: 'chats' } });
  }, [chatId, queryClient, router]);

  const leave = useCallback(async () => {
    const confirmed = await confirm({
      title: 'Покинуть группу?',
      message: leaveMessage(chat, currentUserId),
      confirmLabel: 'Покинуть',
      cancelLabel: 'Отмена',
      destructive: true,
    });

    if (!confirmed || api !== requestClient()) return;

    try {
      await withDeadline(leaveChat(chatId, api), ACTION_DEADLINE_MS);
    } catch (error) {
      if (api === requestClient()) failure('покинуть группу', error);
      return;
    }

    // Говорить в звонке группы я больше не вправе.
    if (api !== requestClient()) return;
    if (getCall()?.chatId === chatId) void leaveCall();

    dropFromList();
  }, [api, chat, chatId, currentUserId, dropFromList]);

  const deleteDialog = useCallback(async () => {
    const confirmed = await confirm({
      title: 'Удалить переписку для всех?',
      message: 'Она исчезнет у вас, у собеседника и у всех, кто её читает. Отменить нельзя.',
      confirmLabel: 'Удалить',
      cancelLabel: 'Отмена',
      destructive: true,
    });

    if (!confirmed || api !== requestClient()) return;

    try {
      await withDeadline(deleteDirectChat(chatId, api), ACTION_DEADLINE_MS);
    } catch (error) {
      if (api === requestClient()) failure('удалить чат', error);
      return;
    }

    if (api !== requestClient()) return;
    if (getCall()?.chatId === chatId) void leaveCall();

    dropFromList();
  }, [api, chatId, dropFromList]);

  const removeMember = useCallback(
    async (person: Person) => {
      const confirmed = await confirm({
        title: `Удалить ${person.displayName} из группы?`,
        message: 'Позвать снова можно будет заявкой.',
        confirmLabel: 'Удалить',
        cancelLabel: 'Отмена',
        destructive: true,
      });

      if (!confirmed || api !== requestClient()) return;

      try {
        await withDeadline(removeChatMember(chatId, person.id, api), ACTION_DEADLINE_MS);
      } catch (error) {
        if (api === requestClient()) failure('удалить участника', error);
        return;
      }

      void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId) });
    },
    [api, chatId, queryClient],
  );

  const cancelInvite = useCallback(
    async (person: Person) => {
      try {
        await withDeadline(cancelChatInvite(chatId, person.id, api), ACTION_DEADLINE_MS);
      } catch (error) {
        if (api === requestClient()) failure('отменить приглашение', error);
        return;
      }

      void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId) });
    },
    [api, chatId, queryClient],
  );

  return { leave, deleteDialog, removeMember, cancelInvite };
}
