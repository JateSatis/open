import { useRouteParams } from '@/navigation';
import { useEffect } from 'react';

import { useAppActive } from '@/features/pops/PopViewer/useAppActive';
import {
  endChatSession,
  startChatSession,
  updateChatRole,
  type ChatRole,
} from '@/features/recs/journal/chatJournal';

/**
 * Сессия экрана чата в журнале рекомендаций: идёт, пока чат наверху и
 * приложение на переднем плане. Откуда пришли — параметр `from` (поиск,
 * уведомление) или список чатов.
 */
export function useChatJournal(chatId: string, live: boolean, role: ChatRole) {
  const appActive = useAppActive();
  const params = useRouteParams<'Chat'>();
  const entry = params.from ?? 'list';
  const running = live && appActive;

  useEffect(() => {
    if (running) startChatSession(chatId, entry, role);
    else endChatSession(chatId);
    // Роль догоняет отдельно: смена роли — не новая сессия.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, running]);

  useEffect(() => updateChatRole(chatId, role), [chatId, role]);

  useEffect(() => () => endChatSession(chatId), [chatId]);
}
