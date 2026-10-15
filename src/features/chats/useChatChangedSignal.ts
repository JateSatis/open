import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { subscribeToChatSignals } from '@/api/chats';
import { chatQueryKey } from '@/features/chats/useChat';

/**
 * Чат перечитывается, когда он изменился: название, описание, фото, состав,
 * заявки — или его удалили. Для экранов без переписки (страница чата,
 * открытая ссылкой): переписка слушает то же сама. Топик общий
 * (`chatTopics`), второй слушатель канала не открывает.
 */
export function useChatChangedSignal(chatId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: chatQueryKey(chatId) });

    return subscribeToChatSignals(chatId, {
      onChatChanged: refresh,
      onMembersChanged: refresh,
      onReconnected: refresh,
    });
  }, [chatId, queryClient]);
}
