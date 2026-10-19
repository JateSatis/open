// Порядок «Чатов» — без запросов: им же пользуются оптимистичные правки
// кеша списка, а тесты, где API замокан, не должны тянуть клиент Supabase.

import type { ChatSummary } from '@/api/chats';

/** Место чата в «Чатах»: позднее из последней активности и моего момента входа. */
export function chatListOrderAt(chat: ChatSummary): string | null {
  const { lastActivityAt: activity, enteredAt: entered } = chat;

  if (activity === null) return entered;
  if (entered === null) return activity;

  // Время — строки ISO из базы: у них разная запись зоны и долей секунды,
  // сравнивать их надо как моменты, а не как текст.
  return Date.parse(entered) > Date.parse(activity) ? entered : activity;
}

/** Порядок «Чатов»: свежие сверху; чат без активности и без момента входа — в конце. */
export function byChatListOrder(a: ChatSummary, b: ChatSummary): number {
  const left = chatListOrderAt(a);
  const right = chatListOrderAt(b);

  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;

  return Date.parse(right) - Date.parse(left);
}
