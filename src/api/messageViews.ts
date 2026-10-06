// Просмотры сообщений: запись пачкой и перечитывание счётчиков.

import { supabase } from '@/api/supabase';

/** Сколько id принимает `record_message_views` за вызов. */
export const MAX_VIEWS_BATCH = 200;

export type MessageViews = { id: string; viewsCount: number; readAt: string | null };

/**
 * Засчитать показ сообщений чата на экране. `sessionId` — одно открытие
 * экрана чата: в его пределах сообщение получает не больше одного просмотра.
 * Своё, чужого чата, удалённое и островки база молча пропускает.
 */
export async function recordMessageViews(
  chatId: string,
  messageIds: string[],
  sessionId: string,
): Promise<void> {
  if (messageIds.length === 0) return;

  const { error } = await supabase.rpc('record_message_views', {
    target_chat: chatId,
    message_ids: messageIds.slice(0, MAX_VIEWS_BATCH),
    session_id: sessionId,
  });

  if (error) throw error;
}

/** Свежие просмотры и «прочитано» у этих сообщений — только живых. */
export async function listMessageViews(messageIds: string[]): Promise<MessageViews[]> {
  if (messageIds.length === 0) return [];

  const { data, error } = await supabase
    .from('messages')
    .select('id, views_count, read_at')
    .in('id', messageIds)
    .is('deleted_at', null);

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    viewsCount: row.views_count,
    readAt: row.read_at,
  }));
}
