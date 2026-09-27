// Закреплённые сообщения чата. Читать закрепы может любой — переписка
// публична, — закреплять и откреплять только участник: это проверяют функции
// в базе, а не клиент (миграция `20260927100000_message_delete_and_pins.sql`).

import type { QueryData } from '@supabase/supabase-js';

import { toMessageKind, type MessageKind } from '@/api/chats';
import { supabase } from '@/api/supabase';

export type PinnedMessage = {
  messageId: string;
  /** Время самого сообщения — по нему закрепы идут по порядку, как в переписке. */
  messageCreatedAt: string;
  kind: MessageKind;
  text: string | null;
  /** Картинка для миниатюры: фото или постер видео из первого вложения. */
  thumbnailUrl: string | null;
};

const pinsSelect = () =>
  supabase
    .from('message_pins')
    .select(
      'message_id, message:messages(id, created_at, kind, text, attachments(url, poster_url, mime_type, position))',
    );

type PinRow = QueryData<ReturnType<typeof pinsSelect>>[number];

function thumbnailOf(row: NonNullable<PinRow['message']>): string | null {
  const [first] = [...(row.attachments ?? [])].sort((a, b) => a.position - b.position);

  if (!first) return null;
  if (first.mime_type?.startsWith('video/')) return first.poster_url;
  if (first.mime_type?.startsWith('audio/')) return null;

  return first.url;
}

function toPinned(row: PinRow): PinnedMessage | null {
  // Сообщение удалено — его закреп база снимает сама, но между удалением и
  // перечитыванием строка ещё может прийти без сообщения.
  if (!row.message) return null;

  return {
    messageId: row.message_id,
    messageCreatedAt: row.message.created_at,
    // Вид сверяет с известными `toMessage` в chats.ts; здесь для полосы
    // достаточно отличить голосовое и медиа от текста.
    kind: row.message.kind as MessageKind,
    text: row.message.text,
    thumbnailUrl: thumbnailOf(row.message),
  };
}

/** Закрепы чата от самого старого сообщения к самому новому. */
export async function listPinnedMessages(chatId: string): Promise<PinnedMessage[]> {
  const { data, error } = await pinsSelect().eq('chat_id', chatId).is('deleted_at', null);

  if (error) throw error;

  return (data ?? [])
    .map(toPinned)
    .filter((pin): pin is PinnedMessage => pin !== null)
    .sort((a, b) => (a.messageCreatedAt < b.messageCreatedAt ? -1 : 1));
}

export async function pinMessage(messageId: string): Promise<void> {
  const { error } = await supabase.rpc('pin_message', { target_message: messageId });

  if (error) throw error;
}

export async function unpinMessage(messageId: string): Promise<void> {
  const { error } = await supabase.rpc('unpin_message', { target_message: messageId });

  if (error) throw error;
}
