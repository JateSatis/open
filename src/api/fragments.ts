// Фрагменты текста сообщений: реакции и комментарии на кусок текста
// (миграция `20261022100000_message_fragments.sql`). Фрагмент появляется в базе
// только с первой реакцией или первым комментарием; диапазон — code points,
// полуоткрытый `[start, end)`, переводит его клиент (`textOffsets`).

import { listDeletedMessageIds } from '@/api/chats';
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
  /** Кластер, в который фрагмент входит; `null` — пока без кластера. */
  clusterId: string | null;
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
    clusterId: row.cluster_id ?? null,
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

/** Где фрагмент сейчас — для перехода по цитате. */
export type FragmentWhereabouts =
  | {
      state: 'live';
      /** Code points текущего текста. */
      start: number;
      end: number;
      lost: boolean;
      /** Время сообщения — до него догружается история. */
      messageCreatedAt: string;
    }
  | { state: 'deleted' }
  | { state: 'missing' };

/**
 * Свежее положение фрагмента: пока шит был открыт, сообщение могли
 * переписать или удалить. Фрагмент удалённого сообщения SELECT-политика не
 * отдаёт — тогда спрашиваем, удалено ли оно.
 */
export async function locateFragment(
  fragmentId: string,
  messageId: string,
): Promise<FragmentWhereabouts> {
  const { data, error } = await supabase
    .from('message_fragments')
    .select(
      'start_offset, end_offset, anchor_state, message:messages!message_fragments_message_fkey(created_at)',
    )
    .eq('id', fragmentId)
    .maybeSingle();

  if (error) throw error;

  if (data?.message) {
    return {
      state: 'live',
      start: data.start_offset,
      end: data.end_offset,
      lost: data.anchor_state === 'lost',
      messageCreatedAt: data.message.created_at,
    };
  }

  const deleted = await listDeletedMessageIds([messageId]);

  return deleted.includes(messageId) ? { state: 'deleted' } : { state: 'missing' };
}
