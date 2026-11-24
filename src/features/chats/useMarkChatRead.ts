import { useSessionStore } from '@/features/auth/sessionState';
import { ownerOf } from '@/features/auth/sessionOwner';
import { useCallback } from 'react';
import { AppState } from 'react-native';
import type { Reached } from '@/api/historyRead';
import { localHistory } from './messages/local/database';
import { stillReader, useHistoryReader } from './messages/local/reader';

export function useMarkChatRead(chat: string, enabled: boolean) {
  const reader = useHistoryReader();
  const sessionId = useSessionStore(state => ownerOf(state.session)?.sessionId ?? state.localSessionId);
  return useCallback(
    (point: Reached) => {
      const current = useSessionStore.getState();
      if (sessionId !== (ownerOf(current.session)?.sessionId ?? current.localSessionId)) return false;
      if (!reader || !sessionId || !enabled || !stillReader(reader) || AppState.currentState !== 'active')
        return false;
      localHistory().reach({ reader, chat }, point, sessionId);
      return true;
    },
    [reader, chat, enabled, sessionId],
  );
}
