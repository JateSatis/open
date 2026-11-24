import { requestSelection } from '@/api/screenRequest';
import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@/navigation';
import { useCallback, useState } from 'react';

import { startCall, StreamJoinError } from '@/api/streams';
import { showNotice } from '@/features/notifications/alertsStore';
import { askNotificationsOnce, ensureCallMicrophone } from '@/features/streams/callPermissions';
import { prepareLiveKit, type LiveKit } from './livekitGlobals';
import { joinCall } from '@/features/streams/callSession';
import { stopRinging } from '@/features/streams/incomingCall';
import { liveStreamQueryKey } from '@/features/streams/useLiveStream';

export type CallChat = {
  chatId: string;
  chatTitle: string;
  isDirect: boolean;
  /** Участник чата говорит — ему нужен микрофон. Посетитель только слушает. */
  isMember: boolean;
};

function joinErrorText(error: unknown): string {
  return error instanceof StreamJoinError ? error.message : 'Не удалось подключиться к звонку';
}

/**
 * Начать звонок или войти в идущий. Экран звонка открывается сразу и сам
 * показывает «Подключение…»: ждать токена на экране чата — значит молча
 * держать палец на кнопке.
 */
export function useJoinCall() {
  const api = useRequestClient();
  const router = useRouter();
  const queryClient = useQueryClient();
  const selection = requestSelection();
  const [joining, setJoining] = useState<number | null>(null);
  const busy = joining === selection;

  const enter = useCallback(
    async (streamId: string, chat: CallChat, preparation: Promise<LiveKit>) => {
      if (selection !== requestSelection()) return;
      stopRinging(streamId);
      router.push({ name: 'Call' });

      try {
        await joinCall(
          {
            streamId,
            chatId: chat.chatId,
            chatTitle: chat.chatTitle,
            isDirect: chat.isDirect,
          },
          preparation,
          api,
        );
      } catch (error) {
        if (selection !== requestSelection()) return;
        if (router.canGoBack()) router.back();
        showNotice(joinErrorText(error), 'error');
        void queryClient.invalidateQueries({ queryKey: liveStreamQueryKey(chat.chatId) });
      }
    },
    [api, queryClient, router, selection],
  );

  /** Кнопка «Позвонить»: новый звонок или уже идущий в этом чате. */
  const start = useCallback(
    async (chat: CallChat) => {
      if (busy || selection !== requestSelection()) return;

      setJoining(selection);
      const preparation = prepareLiveKit();

      try {
        if (!(await ensureCallMicrophone())) return;

        if (selection !== requestSelection()) return;
        await askNotificationsOnce();

        if (selection !== requestSelection()) return;
        let streamId: string;

        try {
          ({ streamId } = await startCall(chat.chatId, api));
        } catch {
          if (selection !== requestSelection()) return;
          showNotice('Не удалось начать звонок', 'error');
          return;
        }

        void queryClient.invalidateQueries({ queryKey: liveStreamQueryKey(chat.chatId) });
        await enter(streamId, chat, preparation);
      } finally {
        setJoining(current => current === selection ? null : current);
      }
    },
    [api, busy, enter, queryClient, selection],
  );

  /** Полоса звонка или «Присоединиться» во входящем. */
  const join = useCallback(
    async (streamId: string, chat: CallChat) => {
      if (busy || selection !== requestSelection()) return;

      setJoining(selection);
      const preparation = prepareLiveKit();

      try {
        if (chat.isMember && !(await ensureCallMicrophone())) return;

        if (selection !== requestSelection()) return;
        await askNotificationsOnce();
        await enter(streamId, chat, preparation);
      } finally {
        setJoining(current => current === selection ? null : current);
      }
    },
    [busy, enter, selection],
  );

  return { start, join, busy };
}
