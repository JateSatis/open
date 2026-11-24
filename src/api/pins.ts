// Закреплённые сообщения чата. Читать закрепы может любой — переписка
// публична, — закреплять и откреплять только участник: это проверяют функции
// в базе, а не клиент (миграция `20260927100000_message_delete_and_pins.sql`).

import { requestClient } from '@/api/requestClient';
import type { QueryData } from '@supabase/supabase-js';

import { toMessageKind, type MessageKind } from '@/api/chats';

export type PinnedMessage = {
  messageId: string;
  /**
   * Островок этого чата, где стоит закреплённое, — у сообщения из другого
   * чата. `null` — сообщение живёт в этом чате.
   */
  forwardId: string | null;
  /**
   * Где сообщение стоит в переписке этого чата — его номер или номер
   * островка. По нему закрепы идут по порядку, как в переписке, и по нему же
   * к закрепу прыгают.
   */
  messageSeq: number;
  /** Номер самого сообщения — порядок внутри одного островка. */
  originalSeq: number;
  kind: MessageKind;
  text: string | null;
  /** Картинка для миниатюры: фото или постер видео из первого вложения. */
  thumbnailUrl: string | null;
};

const pinsSelect = (api = requestClient()) =>
  api
    .from('message_pins')
    .select(
      'message_id, forward_id, message:message_rows!message_pins_message_fkey(id, seq, kind, text, attachments:attachment_rows(url, poster_url, mime_type, position, pop:pops(poster_url))), forward:message_rows!message_pins_forward_fkey(seq)',
    );

type PinRow = QueryData<ReturnType<typeof pinsSelect>>[number];

function thumbnailOf(row: NonNullable<PinRow['message']>): string | null {
  const [first] = [...(row.attachments ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  if (!first) return null;
  // Ссылка на поп: своего файла нет, обложка — постер попа.
  if (first.pop) return first.pop.poster_url;
  if (first.mime_type?.startsWith('video/')) return first.poster_url;
  if (first.mime_type?.startsWith('audio/')) return null;

  return first.url;
}

function toPinned(row: PinRow): PinnedMessage | null {
  // Сообщение удалено — его закреп база снимает сама, но между удалением и
  // перечитыванием строка ещё может прийти без сообщения.
  // Колонки представления генератор типов размечает nullable целиком.
  if (!row.message || row.message.seq === null) return null;

  return {
    messageId: row.message_id,
    forwardId: row.forward_id,
    messageSeq: row.forward?.seq ?? row.message.seq,
    originalSeq: row.message.seq,
    kind: toMessageKind(row.message.kind ?? 'system'),
    text: row.message.text,
    thumbnailUrl: thumbnailOf(row.message),
  };
}

/** Закрепы чата от самого старого сообщения к самому новому. */
export async function listPinnedMessages(chatId: string, api = requestClient()): Promise<PinnedMessage[]> {
  const { data, error } = await pinsSelect(api).eq('chat_id', chatId).is('deleted_at', null);

  if (error) throw error;

  return (data ?? [])
    .map(toPinned)
    .filter((pin): pin is PinnedMessage => pin !== null)
    .sort(byPlaceInChat);
}

/** Порядок закрепов — как в переписке: по месту в чате, внутри островка — по номеру оригинала. */
export function byPlaceInChat(a: PinnedMessage, b: PinnedMessage): number {
  return a.messageSeq - b.messageSeq || a.originalSeq - b.originalSeq;
}

/** Закрепляет сообщение; `forwardId` — островок этого чата, где стоит сообщение из другого. */
export async function pinMessage(messageId: string, forwardId: string | null = null, api = requestClient()): Promise<void> {
  const { error } = await api.rpc('pin_message', {
    target_message: messageId,
    in_forward: forwardId ?? undefined,
  });

  if (error) throw error;
}

/** Открепляет сообщение в чате `chatId` — закреп сообщения из островка живёт в чате островка. */
export async function unpinMessage(messageId: string, chatId: string, api = requestClient()): Promise<void> {
  const { error } = await api.rpc('unpin_message', {
    target_message: messageId,
    target_chat: chatId,
  });

  if (error) throw error;
}
