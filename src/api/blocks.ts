// Блокировки и жалобы. Таблицы пишут только функции базы (миграции
// 20261031100000_privacy_blocks.sql, 20261031110000_dialogue_requests.sql):
// блокировка одной транзакцией рвёт дружбу и висящие заявки, жалобы не
// читает никто, кроме модерации. Свои блокировки я читаю сам.

import { toContactError } from '@/api/contactErrors';
import { supabase } from '@/api/supabase';

export type ReportReason = 'spam' | 'harassment' | 'threats' | 'other';

export type BlockedPerson = {
  id: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
};

export type BlockedPage = {
  items: (BlockedPerson & { cursorAt: string; cursorId: string })[];
  /** Курсор следующей страницы; null — дальше пусто. */
  next: { at: string; id: string } | null;
};

export const BLOCKED_PAGE_SIZE = 30;

/** Заблокировал ли я этого человека. Блокировки меня другими не видны. */
export async function isBlockedByMe(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('blocks')
    .select('id')
    .eq('blocked_id', userId)
    .maybeSingle();

  if (error) throw error;

  return data !== null;
}

export async function blockUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc('block_user', { p_user: userId });

  if (error) throw toContactError(error);
}

export async function unblockUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc('unblock_user', { p_user: userId });

  if (error) throw error;
}

/** Мои заблокированные, свежие первыми. */
export async function listBlockedUsers(
  cursor: { at: string; id: string } | null = null,
): Promise<BlockedPage> {
  const { data, error } = await supabase.rpc('list_blocked_users', {
    p_limit: BLOCKED_PAGE_SIZE,
    ...(cursor ? { p_before_created_at: cursor.at, p_before_id: cursor.id } : {}),
  });

  if (error) throw error;

  const items = (data ?? []).map((row) => ({
    id: row.user_id,
    displayName: row.display_name ?? null,
    username: row.username ?? null,
    avatarUrl: row.avatar_url ?? null,
    cursorAt: row.created_at,
    cursorId: row.block_id,
  }));
  const last = items[items.length - 1];

  return {
    items,
    next:
      items.length === BLOCKED_PAGE_SIZE && last ? { at: last.cursorAt, id: last.cursorId } : null,
  };
}

export type ReportInput = {
  userId: string;
  reason: ReportReason;
  /** Заявка на диалог, на которую жалуюсь; без неё — жалоба на профиль. */
  chatId?: string | null;
  comment?: string;
  /** Заодно заблокировать — той же транзакцией. */
  block?: boolean;
};

/** Повтор той же жалобы база не дублирует. */
export async function reportUser({
  userId,
  reason,
  chatId,
  comment,
  block,
}: ReportInput): Promise<void> {
  const { error } = await supabase.rpc('report_user', {
    p_user: userId,
    p_reason: reason,
    // Функция принимает NULL, но генератор типов не размечает скалярные
    // аргументы rpc как nullable — отсюда приведение.
    p_chat: (chatId ?? null) as string,
    p_comment: (comment?.trim() || null) as string,
    p_block: block ?? false,
  });

  if (error) throw toContactError(error);
}
