// Фрагменты текста сообщений: реакции и комментарии на кусок текста
// (миграция `20261022100000_message_fragments.sql`). Фрагмент появляется в базе
// только с первой реакцией или первым комментарием; диапазон — code points,
// полуоткрытый `[start, end)`, переводит его клиент (`textOffsets`).

import { toAudience, type MyReaction, type ReactionCounts } from '@/api/reactionCounts';
import { supabase } from '@/api/supabase';

/** Диапазон текста, как его понимает база: code points и сам кусок для сверки. */
export type FragmentRange = { start: number; end: number; text: string };

export type Fragment = {
  id: string;
  messageId: string;
  authorId: string | null;
  start: number;
  end: number;
  exactText: string;
  /** Правка унесла текст фрагмента: на тексте его нет, комментарии живут. */
  lost: boolean;
  memberReactions: ReactionCounts;
  visitorReactions: ReactionCounts;
  reactionsCount: number;
  commentsCount: number;
  /** Моя реакция на фрагмент. */
  mine: string | null;
};

function toCounts(value: unknown): ReactionCounts {
  return value && typeof value === 'object' ? (value as ReactionCounts) : {};
}

/** Живые фрагменты сообщения со счётчиками и моей реакцией. */
export async function listMessageFragments(messageId: string): Promise<Fragment[]> {
  const { data, error } = await supabase.rpc('list_message_fragments', {
    target_message: messageId,
  });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    messageId: row.message_id,
    authorId: row.author_id,
    start: row.start_offset,
    end: row.end_offset,
    exactText: row.exact_text,
    lost: row.anchor_state === 'lost',
    memberReactions: toCounts(row.member_reactions),
    visitorReactions: toCounts(row.visitor_reactions),
    reactionsCount: row.reactions_count,
    commentsCount: row.comments_count,
    mine: row.my_emoji ?? null,
  }));
}

/**
 * Приводит мою реакцию на мой фрагмент этого диапазона к `emoji`. Фрагмента
 * ещё нет — база создаёт его в той же транзакции; `null` снимает реакцию и
 * ничего не создаёт. Отдаёт фрагмент и мою реакцию на нём.
 */
export async function setFragmentReaction(
  messageId: string,
  range: FragmentRange,
  emoji: string | null,
): Promise<{ fragmentId: string | null; mine: MyReaction | null }> {
  const { data, error } = await supabase.rpc('set_fragment_reaction', {
    target_message: messageId,
    range_start: range.start,
    range_end: range.end,
    range_text: range.text,
    // Снятие — это NULL, а генератор типов не размечает скалярные аргументы
    // rpc как nullable.
    reaction: emoji as string,
  });

  if (error) throw error;

  const row = data?.[0];

  return {
    fragmentId: row?.fragment_id ?? null,
    mine: row?.emoji ? { emoji: row.emoji, audience: toAudience(row.audience) } : null,
  };
}

/**
 * Реакция на фрагмент по его id — из панели фрагмента: она может быть и
 * чужой. Тот же `set_reaction`, что у сообщений.
 */
export async function setFragmentReactionById(
  fragmentId: string,
  emoji: string | null,
): Promise<MyReaction | null> {
  const { data, error } = await supabase.rpc('set_reaction', {
    target_type: 'fragment',
    target_id: fragmentId,
    reaction: emoji as string,
  });

  if (error) throw error;

  const row = data?.[0];

  return row ? { emoji: row.emoji, audience: toAudience(row.audience) } : null;
}
