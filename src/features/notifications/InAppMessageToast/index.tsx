import { useQueryClient } from '@tanstack/react-query';

import { ToastCard, type ToastGroup } from './ToastCard';

import { cachedChat } from '@/features/chats/cachedChat';
import { chatTitle } from '@/features/chats/chatDisplay';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { dismissAlert, useInAppAlert } from '@/features/notifications/alertsStore';

/**
 * Карточка о новом сообщении, заявке или короткий ответ на действие («Скопировано»)
 * поверх любого экрана. Живёт в корневом layout,
 * потому что уведомление не принадлежит ни одной вкладке.
 */
export function InAppMessageToast() {
  const alert = useInAppAlert((state) => state.alert);
  const queryClient = useQueryClient();
  const currentUserId = useCurrentUserId();

  // Сообщение группы подписано группой — её названием и фото, как пост
  // каналом. Событие их не несёт: лицо берётся из кеша чатов.
  const chat =
    alert?.kind === 'message' && !alert.channel ? cachedChat(queryClient, alert.chatId) : undefined;
  const group: ToastGroup | null =
    chat?.kind === 'group'
      ? { title: chatTitle(chat, currentUserId), avatarUrl: chat.avatarUrl }
      : null;

  return <ToastCard alert={alert} dismiss={dismissAlert} group={group} />;
}
