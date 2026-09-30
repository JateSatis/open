import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import type { ChatSummary } from '@/api/chats';
import type { LiveStream } from '@/api/streams';
import { chatTitle } from '@/features/chats/chatDisplay';
import { useActiveCall } from '@/features/streams/callStore';
import { useJoinCall, type CallChat } from '@/features/streams/useJoinCall';
import { useLiveStream } from '@/features/streams/useLiveStream';

export type ChatCall = {
  stream: LiveStream | null;
  /** Я сейчас в звонке этого чата. */
  isInThisCall: boolean;
  busy: boolean;
  /** Кнопка «Позвонить» — только участнику; идёт звонок — ведёт в него. */
  startOrJoin: () => void;
  /** Тап по полосе: участник войдёт говорящим, посетитель — слушателем. */
  openBar: () => void;
};

/** Всё о звонке для экрана чата: идущий звонок, кнопка в шапке и полоса. */
export function useChatCall(
  chatId: string,
  chat: ChatSummary | null,
  currentUserId: string | null,
  isMember: boolean,
): ChatCall {
  const router = useRouter();
  const stream = useLiveStream(chatId);
  const activeCall = useActiveCall();
  const { start, join, busy } = useJoinCall();
  const isInThisCall = activeCall !== null && activeCall.chatId === chatId;

  const callChat = useCallback(
    (): CallChat | null =>
      chat
        ? {
            chatId,
            chatTitle: chatTitle(chat, currentUserId),
            isDirect: chat.kind === 'direct',
            isMember,
          }
        : null,
    [chat, chatId, currentUserId, isMember],
  );

  const startOrJoin = useCallback(() => {
    const target = callChat();

    if (!target) return;

    if (isInThisCall) {
      router.push('/call');
      return;
    }

    if (stream) {
      void join(stream.id, target);
      return;
    }

    void start(target);
  }, [callChat, isInThisCall, join, router, start, stream]);

  const openBar = useCallback(() => {
    const target = callChat();

    if (!target || !stream) return;

    if (isInThisCall) {
      router.push('/call');
      return;
    }

    void join(stream.id, target);
  }, [callChat, isInThisCall, join, router, stream]);

  return { stream, isInThisCall, busy, startOrJoin, openBar };
}
