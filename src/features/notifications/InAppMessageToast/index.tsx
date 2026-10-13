import { useQueryClient } from '@tanstack/react-query';

import { ToastCard, type ToastGroup } from './ToastCard';

import type { ChatSummary } from '@/api/chats';
import { chatTitle } from '@/features/chats/chatDisplay';
import { chatsQueryKey } from '@/features/chats/chatsKey';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { useInAppAlerts } from '@/features/notifications/useInAppAlerts';

/**
 * Карточка о новом сообщении, заявке или короткий ответ на действие («Скопировано»)
 * поверх любого экрана. Живёт в корневом layout,
 * потому что уведомление не принадлежит ни одной вкладке.
 */
export function InAppMessageToast() {
  const { alert, dismiss } = useInAppAlerts();
  const queryClient = useQueryClient();
  const currentUserId = useCurrentUserId();

  // Сообщение группы подписано группой — её названием и фото, как пост
  // каналом. Событие их не несёт: лицо берётся из списка чатов.
  const chat =
    alert?.kind === 'message' && !alert.channel
      ? queryClient
          .getQueryData<ChatSummary[]>(chatsQueryKey)
          ?.find((candidate) => candidate.id === alert.chatId)
      : undefined;
  const group: ToastGroup | null =
    chat?.kind === 'group'
      ? { title: chatTitle(chat, currentUserId), avatarUrl: chat.avatarUrl }
      : null;

  return <ToastCard alert={alert} dismiss={dismiss} group={group} />;
}
