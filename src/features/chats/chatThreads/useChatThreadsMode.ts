import { useCallback, useEffect, useState } from 'react';
import type { ChatSummary } from '@/api/chats';
import type { HistoryView } from '@/features/chats/messages/historyCache';

/** Вид «Треды» есть в группе, где сейчас не меньше трёх участников. */
export const CHAT_THREADS_MIN_PARTICIPANTS = 3;
const UNAVAILABLE_CONFIRMATION_MS = 600;

export function chatThreadsAvailable(chat: ChatSummary | null): boolean {
  return chat?.kind === 'group' && chat.participants.length >= CHAT_THREADS_MIN_PARTICIPANTS;
}

/**
 * Вид переписки группы: обычный или «Треды». Не запоминается — каждое
 * открытие чата начинается с обычного. Группа уменьшилась до двоих — вид
 * возвращается в обычный.
 */
export function useChatThreadsView(chat: ChatSummary | null) {
  const reportedAvailable = chatThreadsAvailable(chat);
  const [chosen, setView] = useState<HistoryView>('all');
  const [heldAvailable, setHeldAvailable] = useState(reportedAvailable);
  const available = reportedAvailable || heldAvailable;
  const view: HistoryView = available ? chosen : 'all';
  const chooseView = useCallback((next: HistoryView) => {
    setView(next);
    if (next === 'chat-threads') setHeldAvailable(true);
  }, []);

  // Перечитывание участников может ненадолго вернуть неполный список. Не
  // выбрасываем человека из «Тредов» из-за этого промежуточного состояния;
  // реальное уменьшение группы подтверждается короткой задержкой.
  useEffect(() => {
    if (reportedAvailable) return;

    if (!heldAvailable) return;

    const timer = setTimeout(() => {
      setHeldAvailable(false);
      setView('all');
    }, UNAVAILABLE_CONFIRMATION_MS);

    return () => clearTimeout(timer);
  }, [heldAvailable, reportedAvailable]);

  return { view, available, setView: chooseView };
}
