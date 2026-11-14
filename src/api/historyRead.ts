import { supabase } from './supabase';
import type { HistoryPosition } from './historyWindow';

export type Reached = HistoryPosition & { key: string };

export async function getHistoryRead(chat: string) {
  const { data, error } = await supabase.rpc('history_read_state', { p_chat: chat }).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    seq: data.read_seq,
    position: data.read_position,
    first: data.first_message
      ? {
          key: data.first_item ?? data.first_message,
          messageId: data.first_message,
          itemId: data.first_item,
          seq: data.first_seq,
          position: data.first_position,
          offset: 0,
        }
      : null,
  };
}

export async function advanceHistoryRead(reader: string, chat: string, point: Reached) {
  const { data, error } = await supabase
    .rpc('advance_history_read', {
      p_expected_reader: reader,
      p_chat: chat,
      p_seq: point.seq,
      p_position: point.position,
      p_key: point.key,
    })
    .single();
  if (error) throw error;
  return { seq: data.read_seq, position: data.read_position };
}
