// Сообщение одной строкой — для цитаты в облачке, плашки над полем ввода и
// строки «Переслано от». Правило одно на всех, поэтому и место одно.

import type { ForwardOrigin, Message } from '@/api/chats';
import { toPreview, type MessagePreview } from '@/api/messagePreview';
import type { ComposerMode } from '@/features/chats/composerDraftStore';
import type { ChatMessage, LiveQuote } from '@/features/chats/messages/types';
import { formatDuration } from '@/features/media/lib/formatDuration';

export const DELETED_ACCOUNT = 'Удалённый аккаунт';

/** Сколько сообщений можно процитировать разом — столько же принимает база. */
export const MAX_QUOTES = 100;

/** Сколько сообщений можно переслать разом — столько же принимает база. */
export const MAX_FORWARD = 100;

/** «1 сообщение», «3 сообщения», «11 сообщений». */
export function messagesCount(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? 'сообщение'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'сообщения'
        : 'сообщений';

  return `${n} ${word}`;
}

export function previewOf(message: Message): MessagePreview {
  return toPreview(
    message.kind,
    message.text,
    message.attachments.map((attachment, position) => ({
      url: attachment.url,
      poster_url: attachment.posterUrl,
      mime_type: attachment.mimeType,
      duration_ms: attachment.durationMs,
      position,
    })),
  );
}

/** «Фото», «Альбом», «🎤 Голосовое сообщение (0:12)» — или сам текст. */
export function describePreview(preview: MessagePreview): string {
  const text = preview.text?.trim();

  if (text) return text.replace(/\s+/g, ' ');

  if (preview.kind === 'voice') {
    // Как в превью списка чатов: «0:00» у голосового выглядит поломкой.
    return preview.durationMs
      ? `🎤 Голосовое сообщение (${formatDuration(Math.max(preview.durationMs, 1000))})`
      : '🎤 Голосовое сообщение';
  }

  if (preview.mediaCount > 1) return 'Альбом';
  if (preview.mediaCount === 1) return preview.firstMediaIsVideo ? 'Видео' : 'Фото';
  if (preview.kind === 'video') return 'Видео';
  if (preview.kind === 'photo' || preview.kind === 'media') return 'Фото';

  return 'Сообщение';
}

/** Цитата из сообщения, которое сейчас на экране. */
export function quoteOf(message: ChatMessage, authorName: string): LiveQuote {
  return {
    messageId: message.id,
    state: 'live',
    authorId: message.authorId,
    authorName: message.authorId ? authorName : null,
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    preview: previewOf(message),
  };
}

/**
 * Чьё сообщение пересылается. Пересланное пересылается от первоисточника,
 * а не от промежуточного звена — так же решает и база.
 */
export function originOf(message: ChatMessage, authorName: string): ForwardOrigin {
  if (message.forward) return message.forward;

  return {
    authorId: message.authorId,
    authorName: message.authorId ? authorName : null,
    original: { messageId: message.id, chatId: message.chatId, createdAt: message.createdAt },
  };
}

export function byOldest<T extends { createdAt: string; id?: string }>(a: T, b: T): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id === undefined || b.id === undefined || a.id === b.id) return 0;

  return a.id < b.id ? -1 : 1;
}

function authorsOf(names: (string | null)[]): string {
  return [...new Set(names.map((name) => name ?? DELETED_ACCOUNT))].join(', ');
}

/** Что написать на плашке над полем ввода. */
export function describeMode(mode: ComposerMode): {
  title: string;
  snippet: string;
  thumbnailUrl: string | null;
  closeLabel: string;
} {
  if (mode.type === 'edit') {
    // Миниатюры нет: вложения правки лежат под плашкой целиком.
    return {
      title: 'Редактирование',
      snippet: describePreview(previewOf(mode.message)),
      thumbnailUrl: null,
      closeLabel: 'Отменить редактирование',
    };
  }

  if (mode.type === 'reply') {
    const [first] = mode.quotes;

    return mode.quotes.length === 1
      ? {
          title: `В ответ ${first.authorName ?? DELETED_ACCOUNT}`,
          snippet: describePreview(first.preview),
          thumbnailUrl: first.preview.thumbnailUrl,
          closeLabel: 'Отменить ответ',
        }
      : {
          title: `В ответ на ${messagesCount(mode.quotes.length)}`,
          snippet: authorsOf(mode.quotes.map((quote) => quote.authorName)),
          thumbnailUrl: null,
          closeLabel: 'Отменить ответ',
        };
  }

  const [first] = mode.items;

  return mode.items.length === 1
    ? {
        title: `Переслать: ${first.origin.authorName ?? DELETED_ACCOUNT}`,
        snippet: describePreview(previewOf(first.message)),
        thumbnailUrl: previewOf(first.message).thumbnailUrl,
        closeLabel: 'Отменить пересылку',
      }
    : {
        title: `Переслать ${messagesCount(mode.items.length)}`,
        snippet: authorsOf(mode.items.map((item) => item.origin.authorName)),
        thumbnailUrl: null,
        closeLabel: 'Отменить пересылку',
      };
}
