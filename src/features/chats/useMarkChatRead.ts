import { useCallback } from 'react';
import { AppState } from 'react-native';
import type { Reached } from '@/api/historyRead';
import { localHistory } from './messages/local/database';
import { stillReader, useHistoryReader } from './messages/local/reader';

export function useMarkChatRead(chat: string, enabled: boolean) {
  const reader = useHistoryReader();
  return useCallback(
    (point: Reached) => {
      if (!reader || !enabled || !stillReader(reader) || AppState.currentState !== 'active')
        return false;
      localHistory().reach({ reader, chat }, point);
      return true;
    },
    [reader, chat, enabled],
  );
}
