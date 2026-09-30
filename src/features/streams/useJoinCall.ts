import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { startCall, StreamJoinError } from '@/api/streams';
import { showNotice } from '@/features/notifications/alertsStore';
import { askNotificationsOnce, ensureCallMicrophone } from '@/features/streams/callPermissions';
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
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const enter = useCallback(
    async (streamId: string, chat: CallChat) => {
      stopRinging(streamId);
      router.push('/call');

      try {
        await joinCall({
          streamId,
          chatId: chat.chatId,
          chatTitle: chat.chatTitle,
          isDirect: chat.isDirect,
        });
      } catch (error) {
        if (router.canGoBack()) router.back();
        showNotice(joinErrorText(error), 'error');
        void queryClient.invalidateQueries({ queryKey: liveStreamQueryKey(chat.chatId) });
      }
    },
    [queryClient, router],
  );

  /** Кнопка «Позвонить»: новый звонок или уже идущий в этом чате. */
  const start = useCallback(
    async (chat: CallChat) => {
      if (busy) return;

      setBusy(true);

      try {
        if (!(await ensureCallMicrophone())) return;

        await askNotificationsOnce();

        let streamId: string;

        try {
          ({ streamId } = await startCall(chat.chatId));
        } catch {
          showNotice('Не удалось начать звонок', 'error');
          return;
        }

        void queryClient.invalidateQueries({ queryKey: liveStreamQueryKey(chat.chatId) });
        await enter(streamId, chat);
      } finally {
        setBusy(false);
      }
    },
    [busy, enter, queryClient],
  );

  /** Полоса звонка или «Присоединиться» во входящем. */
  const join = useCallback(
    async (streamId: string, chat: CallChat) => {
      if (busy) return;

      setBusy(true);

      try {
        if (chat.isMember && !(await ensureCallMicrophone())) return;

        await askNotificationsOnce();
        await enter(streamId, chat);
      } finally {
        setBusy(false);
      }
    },
    [busy, enter],
  );

  return { start, join, busy };
}
