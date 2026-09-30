// Реакции. Поставить может кто угодно в любом чате, а в какой ряд — участников
// или посетителей — она попадёт, решает база по `chat_members` в момент
// постановки (миграция `20260930100000_reactions.sql`). Клиент ряд не
// выбирает и не может: он только узнаёт его из ответа.
//
// Счётчики хранятся на самом сообщении, по рядам, и приходят той же выборкой,
// что и переписка (`MESSAGE_COLUMNS`); своя реакция — вычисляемой связью
// `my_reaction`, тоже в той же выборке.

import { REACTION_COLUMNS, toAudience, toReactions, type MessageReactions, type MyReaction } from '@/api/reactionCounts';
import { supabase } from '@/api/supabase';

export * from '@/api/reactionCounts';

/**
 * Приводит мою реакцию на сообщение к `emoji`: ставит, меняет или снимает
 * (`null`). Повтор того же вызова безопасен. Отдаёт, какой реакция стала и
 * в каком она ряду.
 */
export async function setMessageReaction(
  messageId: string,
  emoji: string | null,
): Promise<MyReaction | null> {
  const { data, error } = await supabase.rpc('set_reaction', {
    target_type: 'message',
    target_id: messageId,
    // Снятие — это NULL, а генератор типов не размечает скалярные аргументы
    // rpc как nullable.
    reaction: emoji as string,
  });

  if (error) throw error;

  const row = data?.[0];

  return row ? { emoji: row.emoji, audience: toAudience(row.audience) } : null;
}

/** Столько сообщений за раз — как у остальных сверок загруженного. */
const MAX_IDS = 1000;

/**
 * Свежие реакции этих сообщений — счётчики по рядам и моя. Одним запросом:
 * так дочитываются пропущенные события и перечитывается пачка сообщений,
 * на которые только что поставили реакции. Удалённые база не отдаёт.
 */
export async function listMessageReactions(
  messageIds: string[],
): Promise<{ id: string; reactions: MessageReactions }[]> {
  if (messageIds.length === 0) return [];

  const { data, error } = await supabase
    .from('messages')
    .select(`id, ${REACTION_COLUMNS}` as const)
    .in('id', messageIds.slice(0, MAX_IDS))
    .is('deleted_at', null);

  if (error) throw error;

  return (data ?? []).map((row) => ({ id: row.id, reactions: toReactions(row) }));
}
