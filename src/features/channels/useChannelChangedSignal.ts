import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { subscribeToChatSignals } from '@/api/chats';
import { channelQueryKey } from '@/features/channels/keys';

/**
 * Канал перечитывается, когда владелец его изменил: название, описание,
 * `@имя`, фото. Сигнал — `chat_changed` в топике чата постов (база шлёт его
 * из `set_channel_*`); топик общий (`chatTopics`), переписка «Постов» слушает
 * его же, второго канала Realtime не открывается.
 */
export function useChannelChangedSignal(channelId: string, postsChatId: string) {
  const api = useRequestClient();
  const queryClient = useQueryClient();

  useEffect(() => {
    const refresh = () =>
      void queryClient.invalidateQueries({ queryKey: channelQueryKey(channelId), exact: true });

    return subscribeToChatSignals(postsChatId, {
      onChatChanged: refresh,
      onReconnected: refresh,
    }, api);
  }, [api, channelId, postsChatId, queryClient]);
}
