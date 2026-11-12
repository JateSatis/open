import { MESSAGE_PAGE_SIZE } from '@/api/messagePage';
import {
  HISTORY_ELEMENT_COLUMNS,
  HISTORY_PAGE_COLUMNS,
  HISTORY_PAGE_UNIQUE_EMBEDS,
  toMessage,
  type Message,
} from '@/api/messageRows';
import type { Json } from '@/api/types.gen';
import { supabase } from '@/api/supabase';

export type HistoryPosition = { seq: number; position: number };
export type HistoryCursor<D extends 'before' | 'after' = 'before' | 'after'> = HistoryPosition & {
  chatId: string;
  direction: D;
};
export type HistoryWindowRequest = { limit?: number } & (
  | {
      mode: 'latest';
      messageId?: never;
      itemId?: never;
      savedSeq?: never;
      savedPosition?: never;
      cursor?: never;
    }
  | {
      mode: 'around';
      messageId: string;
      itemId?: string;
      savedSeq?: number;
      savedPosition?: number;
      cursor?: never;
    }
  | {
      mode: 'before';
      cursor: HistoryCursor<'before'>;
      messageId?: never;
      itemId?: never;
      savedSeq?: never;
      savedPosition?: never;
    }
  | {
      mode: 'after';
      cursor: HistoryCursor<'after'>;
      messageId?: never;
      itemId?: never;
      savedSeq?: never;
      savedPosition?: never;
    }
);
export type HistoryCoverage = {
  lower: (HistoryPosition & { inclusive: boolean }) | null;
  upper: (HistoryPosition & { inclusive: boolean }) | null;
};
/** Opaque, reader-bound ticket for one coverage interval. */
export type HistorySyncCursor = `h1.${string}`;
export type HistoryItem = {
  /** Occurrence identity: forward_items.id or the ordinary message id. */
  key: string;
  messageId: string;
  forwardItemId: string | null;
  originalId: string | null;
  position: HistoryPosition;
  /** A forward contains ONLY this selected item, never its unloaded siblings. */
  message: Message;
};
export type HistoryWindow = {
  items: HistoryItem[];
  target: 'none' | 'found' | 'substituted' | 'empty' | 'unavailable';
  anchor: (HistoryPosition & { key: string; messageId: string; itemId: string | null }) | null;
  before: HistoryCursor<'before'> | null;
  after: HistoryCursor<'after'> | null;
  coverage: HistoryCoverage | null;
  syncCursor: HistorySyncCursor | null;
  reachedStart: boolean | null;
  reachedEnd: boolean | null;
};
export const HISTORY_WINDOW_MAX_SIZE = 100;

function object(value: Json | undefined): { [key: string]: Json | undefined } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid history metadata');
  return value;
}
function position(value: { [key: string]: Json | undefined }): HistoryPosition {
  if (
    typeof value.seq !== 'number' ||
    !Number.isSafeInteger(value.seq) ||
    value.seq < 0 ||
    typeof value.position !== 'number' ||
    !Number.isInteger(value.position) ||
    value.position < -1 ||
    value.position > 100
  )
    throw new Error('Invalid history position');
  return { seq: value.seq, position: value.position };
}
function cursor<D extends 'before' | 'after'>(
  value: Json,
  chatId: string,
  direction: D,
): HistoryCursor<D> | null {
  if (value === null) return null;
  const row = object(value);
  if (row.chatId !== chatId || row.direction !== direction)
    throw new Error('Invalid history cursor');
  return { ...position(row), chatId, direction };
}
function bound(value: Json | undefined): HistoryCoverage['lower'] {
  if (value === null) return null;
  const row = object(value);
  if (typeof row.inclusive !== 'boolean') throw new Error('Invalid history coverage');
  return { ...position(row), inclusive: row.inclusive };
}

const selectItems = () => supabase.from('history_element_rows').select(HISTORY_ELEMENT_COLUMNS);
type ElementRow = NonNullable<Awaited<ReturnType<typeof selectItems>>['data']>[number];
function toHistoryItem(row: ElementRow): HistoryItem {
  if (!row.id || !row.message || !row.message_id || row.seq === null || row.position === null)
    throw new Error('Invalid history element');
  return {
    key: row.id,
    messageId: row.message_id,
    forwardItemId: row.forward_item_id,
    originalId: row.forward_item?.message_id ?? null,
    position: { seq: row.seq, position: row.position },
    message: toMessage({ ...row.message, items: row.forward_item ? [row.forward_item] : [] }),
  };
}

type RangeRequest = { mode: 'range'; coverage: HistoryCoverage; limit: number };
function syncCursor(value: Json | undefined): HistorySyncCursor {
  if (typeof value !== 'string' || !value.startsWith('h1.'))
    throw new Error('Invalid history sync cursor');
  return value as HistorySyncCursor;
}

/** Ordinary navigation and exact-range replacement share the same projection and decoder. */
async function readWindow(
  chatId: string,
  request: HistoryWindowRequest | RangeRequest,
): Promise<HistoryWindow> {
  const limit = request.limit ?? MESSAGE_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > HISTORY_WINDOW_MAX_SIZE)
    throw new Error('History limit must be an integer from 1 to 100');
  if (request.mode !== 'range' && request.cursor)
    cursor(request.cursor, chatId, request.mode === 'before' ? 'before' : 'after');
  if (
    request.mode !== 'range' &&
    request.savedSeq !== undefined &&
    (!Number.isSafeInteger(request.savedSeq) || request.savedSeq < 1)
  )
    throw new Error('Invalid saved history position');
  if (
    request.mode !== 'range' &&
    request.savedPosition !== undefined &&
    (!Number.isInteger(request.savedPosition) ||
      request.savedPosition < 0 ||
      request.savedPosition > 99)
  )
    throw new Error('Invalid saved history position');
  const rpc =
    request.mode === 'range'
      ? supabase.rpc('get_history_range', {
          p_chat: chatId,
          p_range: request.coverage,
          p_limit: limit,
        })
      : supabase.rpc('get_history_element_window', {
          p_chat: chatId,
          p_mode: request.mode,
          p_limit: limit,
          p_target: request.messageId,
          p_target_item: request.itemId,
          p_hint_seq: request.savedSeq,
          p_hint_position: request.savedPosition,
          p_cursor: request.cursor,
        });
  const query = rpc.select(HISTORY_PAGE_COLUMNS);
  for (const path of HISTORY_PAGE_UNIQUE_EMBEDS) query.limit(1, { referencedTable: path });
  const { data, error } = await query.single();
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
  const a = data.anchor === null ? null : object(data.anchor);
  if (
    a &&
    (typeof a.key !== 'string' ||
      typeof a.messageId !== 'string' ||
      (a.itemId !== null && typeof a.itemId !== 'string'))
  )
    throw new Error('Invalid history anchor');
  const coverage = data.coverage === null ? null : object(data.coverage);
  const covered = coverage ? { lower: bound(coverage.lower), upper: bound(coverage.upper) } : null;
  // The two tables have independent UUID namespaces. Join by the parent FK;
  // never guess whether a bare UUID denotes an ordinary message or an item.
  const children = new Map<string, typeof data.forwards>();
  for (const item of data.forwards) {
    const group = children.get(item.forward_id);
    if (group) group.push(item);
    else children.set(item.forward_id, [item]);
  }
  const items = data.parents
    .flatMap((parent): HistoryItem[] => {
      if (!parent.id || parent.seq === null) throw new Error('Invalid history parent');
      const message = toMessage({ ...parent, items: children.get(parent.id) ?? [] });
      const forward = message.forward;
      if (!forward?.items.length)
        return [
          {
            key: message.id,
            messageId: message.id,
            forwardItemId: null,
            originalId: null,
            position: { seq: message.seq, position: 0 },
            message,
          },
        ];
      return forward.items.map((item) => ({
        key: item.id,
        messageId: message.id,
        forwardItemId: item.id,
        originalId: item.messageId,
        position: { seq: message.seq, position: item.position },
        message: { ...message, forward: { ...forward, items: [item] } },
      }));
    })
    .sort((a, b) => a.position.seq - b.position.seq || a.position.position - b.position.position);
  const order = data.element_ids;
  if (!order || order.length !== items.length || items.some((item, i) => item.key !== order[i]))
    throw new Error('Inconsistent history page');
  for (const item of items) {
    if (!item.message.forwardGroup || !covered) continue;
    const { lower, upper } = covered;
    item.message.forwardRange = {
      start:
        !item.message.hidden && lower?.seq === item.position.seq
          ? Math.max(0, lower.position + (lower.inclusive ? 0 : 1))
          : 0,
      end:
        !item.message.hidden && upper?.seq === item.position.seq
          ? Math.min(99, upper.position - (upper.inclusive ? 0 : 1))
          : 99,
    };
  }
  return {
    items,
    target,
    anchor: a
      ? {
          ...position(a),
          key: a.key as string,
          messageId: a.messageId as string,
          itemId: a.itemId as string | null,
        }
      : null,
    before: cursor(data.before_cursor, chatId, 'before'),
    after: cursor(data.after_cursor, chatId, 'after'),
    coverage: covered,
    syncCursor: covered ? syncCursor(data.sync_cursor) : null,
    reachedStart: target === 'unavailable' ? null : !data.has_before,
    reachedEnd: target === 'unavailable' ? null : !data.has_after,
  };
}

export function getHistoryWindow(
  chatId: string,
  request: HistoryWindowRequest = { mode: 'latest' },
) {
  return readWindow(chatId, request);
}

/** Replace only the returned coverage. If it grew, load remaining as another independent piece. */
export async function getHistoryRange(
  chatId: string,
  coverage: HistoryCoverage,
  limit = HISTORY_WINDOW_MAX_SIZE,
) {
  const page = await readWindow(chatId, { mode: 'range', coverage, limit });
  if (!page.coverage || !page.syncCursor) throw new Error('Missing history range');
  let remaining: HistoryCoverage | null = null;
  if (!page.reachedEnd) {
    if (!page.coverage.upper) throw new Error('Missing history range boundary');
    remaining = { lower: { ...page.coverage.upper, inclusive: false }, upper: coverage.upper };
  }
  return { items: page.items, coverage: page.coverage, syncCursor: page.syncCursor, remaining };
}

export type HistoryChangePage = { parentIds: string[] } & (
  | { status: 'more' | 'current'; cursor: HistorySyncCursor }
  | { status: 'reconcile' | 'expired'; cursor: null }
);

/** Only 'current' acknowledges the saved copy. 'more' is an in-progress pass. */
export async function getHistoryChanges(
  chatId: string,
  ticket: HistorySyncCursor,
  limit = MESSAGE_PAGE_SIZE,
): Promise<HistoryChangePage> {
  if (!Number.isInteger(limit) || limit < 1 || limit > HISTORY_WINDOW_MAX_SIZE)
    throw new Error('Invalid history change limit');
  const { data, error } = await supabase.rpc('get_history_changes', {
    p_chat: chatId,
    p_cursor: ticket,
    p_limit: limit,
  });
  if (error) throw error;
  const { status, cursor: next, parentIds } = object(data);
  if (!Array.isArray(parentIds) || !parentIds.every((id): id is string => typeof id === 'string'))
    throw new Error('Invalid changed parents');
  if (status === 'more' || status === 'current')
    return { status, parentIds, cursor: syncCursor(next) };
  if ((status === 'reconcile' || status === 'expired') && next === null)
    return { status, parentIds, cursor: null };
  throw new Error('Invalid history change page');
}

/** Lightweight membership only: no original contents or group expansion. */
export async function getHistoryGroupKeys(chatId: string, messageId: string) {
  const { data, error } = await supabase
    .from('history_element_rows')
    .select('id,position')
    .eq('chat_id', chatId)
    .eq('message_id', messageId);
  if (error) throw error;
  return (data ?? []).flatMap((row) =>
    row.id !== null && row.position !== null ? [{ key: row.id, position: row.position }] : [],
  );
}

/** Reconcile only already-loaded occurrences after parent/original events. */
export async function getHistoryItems(chatId: string, keys: string[]): Promise<HistoryItem[]> {
  if (!keys.length) return [];
  if (keys.length > HISTORY_WINDOW_MAX_SIZE) throw new Error('History items limit is 100');
  const { data, error } = await supabase
    .rpc('get_history_elements', { p_chat: chatId, p_ids: keys })
    .select(HISTORY_ELEMENT_COLUMNS)
    .order('seq')
    .order('position');
  if (error) throw error;
  return (data ?? []).map(toHistoryItem);
}
