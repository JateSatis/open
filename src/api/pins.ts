// Закреплённые сообщения чата. Читать закрепы может любой — переписка
// публична, — закреплять и откреплять только участник: это проверяют функции
// в базе, а не клиент (миграция `20260927100000_message_delete_and_pins.sql`).

import type { QueryData } from '@supabase/supabase-js';

import { toMessageKind, type MessageKind } from '@/api/chats';
import { supabase } from '@/api/supabase';

export type PinnedMessage = {
  messageId: string;
  /**
   * Островок этого чата, где стоит закреплённое, — у сообщения из другого
   * чата. `null` — сообщение живёт в этом чате.
   */
  forwardId: string | null;
  /**
   * Где сообщение стоит в переписке этого чата — его время или время
   * островка. По нему закрепы идут по порядку, как в переписке, и по нему же
   * к закрепу прыгают.
   */
  messageCreatedAt: string;
  /** Время самого сообщения — порядок внутри одного островка. */
  originalCreatedAt: string;
  kind: MessageKind;
  text: string | null;
  /** Картинка для миниатюры: фото или постер видео из первого вложения. */
  thumbnailUrl: string | null;
};

const pinsSelect = () =>
  supabase
    .from('message_pins')
    .select(
      'message_id, forward_id, message:messages!message_pins_message_fkey(id, created_at, kind, text, attachments(url, poster_url, mime_type, position)), forward:messages!message_pins_forward_fkey(created_at)',
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
    forwardId: row.forward_id,
    messageCreatedAt: row.forward?.created_at ?? row.message.created_at,
    originalCreatedAt: row.message.created_at,
    kind: toMessageKind(row.message.kind),
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
    .sort(byPlaceInChat);
}

/** Порядок закрепов — как в переписке: по месту в чате, внутри островка — по времени оригинала. */
export function byPlaceInChat(a: PinnedMessage, b: PinnedMessage): number {
  if (a.messageCreatedAt !== b.messageCreatedAt) return a.messageCreatedAt < b.messageCreatedAt ? -1 : 1;
  if (a.originalCreatedAt === b.originalCreatedAt) return 0;

  return a.originalCreatedAt < b.originalCreatedAt ? -1 : 1;
}

/** Закрепляет сообщение; `forwardId` — островок этого чата, где стоит сообщение из другого. */
export async function pinMessage(messageId: string, forwardId: string | null = null): Promise<void> {
  const { error } = await supabase.rpc('pin_message', {
    target_message: messageId,
    in_forward: forwardId ?? undefined,
  });

  if (error) throw error;
}

/** Открепляет сообщение в чате `chatId` — закреп сообщения из островка живёт в чате островка. */
export async function unpinMessage(messageId: string, chatId: string): Promise<void> {
  const { error } = await supabase.rpc('unpin_message', {
    target_message: messageId,
    target_chat: chatId,
  });

  if (error) throw error;
}
