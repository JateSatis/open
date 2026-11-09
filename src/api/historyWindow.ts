import { MESSAGE_PAGE_SIZE } from '@/api/messagePage';
import { MESSAGE_COLUMNS, toMessage, type Message } from '@/api/messageRows';
import { supabase } from '@/api/supabase';

export type HistoryCursor<D extends 'before' | 'after' = 'before' | 'after'> = {
  chatId: string;
  direction: D;
  /** Exclusive integer coordinate, not a message identity or access token. */
  seq: number;
};

export type HistoryWindowRequest = { limit?: number } & (
  | { mode: 'latest'; messageId?: never; savedSeq?: never; cursor?: never }
  | { mode: 'around'; messageId: string; savedSeq?: number; cursor?: never }
  | { mode: 'before'; cursor: HistoryCursor<'before'>; messageId?: never; savedSeq?: never }
  | { mode: 'after'; cursor: HistoryCursor<'after'>; messageId?: never; savedSeq?: never }
);

export type HistoryCoverage = {
  /** null is -infinity at the lower bound and +infinity at the upper bound. */
  lower: { seq: number; inclusive: boolean } | null;
  upper: { seq: number; inclusive: boolean } | null;
};

export type HistoryWindow = {
  /** Always ascending seq; includes current viewer-safe hidden placeholders. */
  items: Message[];
  /** empty: no available anchor at savedSeq; safe placeholders may still exist. */
  target: 'none' | 'found' | 'substituted' | 'empty' | 'unavailable';
  anchor: { messageId: string; seq: number } | null;
  before: HistoryCursor<'before'> | null;
  after: HistoryCursor<'after'> | null;
  /** null only for unavailable: no part of history was checked. */
  coverage: HistoryCoverage | null;
  reachedStart: boolean | null;
  reachedEnd: boolean | null;
};

export const HISTORY_WINDOW_MAX_SIZE = 100;

/**
 * One RPC/SQL snapshot, including nested content. No read receipts or cache writes.
 * Coverage is complete only for this viewer/history at this request; it is not a
 * sync version. Traversal without gaps is guaranteed only for unchanged history.
 * At most 100 top-level rows; nested forwards are complete, with no byte cap.
 */
export async function getHistoryWindow(
  chatId: string,
  request: HistoryWindowRequest = { mode: 'latest' },
): Promise<HistoryWindow> {
  const limit = request.limit ?? MESSAGE_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > HISTORY_WINDOW_MAX_SIZE) {
    throw new Error('History limit must be an integer from 1 to 100');
  }
  if (
    request.cursor &&
    (request.cursor.chatId !== chatId ||
      request.cursor.direction !== request.mode ||
      !Number.isSafeInteger(request.cursor.seq) ||
      request.cursor.seq < 0 ||
      (request.mode === 'after' && request.cursor.seq === Number.MAX_SAFE_INTEGER))
  )
    throw new Error('Invalid history cursor');
  if (
    request.savedSeq !== undefined &&
    (!Number.isSafeInteger(request.savedSeq) || request.savedSeq < 1)
  )
    throw new Error('Invalid saved history position');

  const { data, error } = await supabase
    .rpc('get_history_window', {
      p_chat: chatId,
      p_mode: request.mode,
      p_limit: limit,
      p_target: request.messageId,
      p_hint_seq: request.savedSeq,
      p_cursor: request.cursor,
    })
    .select(
      `chat_id, target_status, anchor_id, anchor_seq, before_seq, after_seq,
    has_before, has_after, lower_seq, lower_inclusive, upper_seq, upper_inclusive,
    items:history_window_messages(${MESSAGE_COLUMNS})`,
    )
    .order('seq', { referencedTable: 'items', ascending: true })
    .order('position', { referencedTable: 'items.attachments', ascending: true })
    .single();

  if (error) throw error;
  if (!data) throw new Error('Missing history window');
  const target = data.target_status;
  if (
    target !== 'none' &&
    target !== 'found' &&
    target !== 'substituted' &&
    target !== 'empty' &&
    target !== 'unavailable'
  )
    throw new Error('Invalid history target status');
  const unavailable = target === 'unavailable';
  return {
    items: data.items.map(toMessage),
    target,
    anchor:
      data.anchor_id !== null && data.anchor_seq !== null
        ? { messageId: data.anchor_id, seq: data.anchor_seq }
        : null,
    before: data.before_seq === null ? null : { chatId, direction: 'before', seq: data.before_seq },
    after: data.after_seq === null ? null : { chatId, direction: 'after', seq: data.after_seq },
    reachedStart: unavailable ? null : !data.has_before,
    reachedEnd: unavailable ? null : !data.has_after,
    coverage: unavailable
      ? null
      : {
          lower:
            data.lower_seq === null
              ? null
              : { seq: data.lower_seq, inclusive: data.lower_inclusive === true },
          upper:
            data.upper_seq === null
              ? null
              : { seq: data.upper_seq, inclusive: data.upper_inclusive === true },
        },
  };
}
