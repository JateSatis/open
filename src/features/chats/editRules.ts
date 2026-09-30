// Что можно и чего нельзя в режиме правки. Итог правки обязан быть допустимым
// сообщением по тем же правилам, что и новое: только текст, альбом с подписью
// или без, одно голосовое без подписи. Интерфейс не даёт прийти в другое
// состояние; база проверяет то же самое ещё раз (`edit_message`).

import type { MessageKind } from '@/api/chats';
import { MAX_ALBUM_SIZE } from '@/features/chats/lib/mosaicLayout';
import type { ChatMessage, EditResult } from '@/features/chats/messages/types';

/** Правка без содержимого — в ней нечего сохранять. */
export function isEditEmpty(result: EditResult): boolean {
  return (
    !result.text.trim() && result.kept.length === 0 && result.added.length === 0 && !result.voice
  );
}

/** Каким станет сообщение после правки — так же решает и база. */
export function editResultKind(result: EditResult): MessageKind {
  if (result.voice) return 'voice';
  if (result.kept.length + result.added.length > 0) return 'media';

  return 'text';
}

/** Ничего не изменилось — «О» просто выходит из правки. */
export function isEditUnchanged(original: ChatMessage, result: EditResult): boolean {
  if (result.text.trim() !== (original.text ?? '').trim()) return false;
  if (result.added.length > 0) return false;

  if (original.kind === 'voice') {
    return (
      result.voice?.type === 'kept' &&
      result.voice.attachment.id === original.attachments[0]?.id &&
      result.kept.length === 0
    );
  }

  if (result.voice) return false;

  const before = original.attachments.map((attachment) => attachment.id);
  const after = result.kept.map((attachment) => attachment.id);

  return before.length === after.length && before.every((id, index) => id === after[index]);
}

/**
 * Голосовое идёт без подписи и без других вложений, поэтому записать новое
 * можно только в пустую правку.
 */
export function canRecordInEdit(result: EditResult): boolean {
  return isEditEmpty(result);
}

/** Сколько ещё файлов влезает в альбом правки. */
export function editMediaRoom(result: Pick<EditResult, 'kept' | 'voice'>): number {
  return result.voice ? 0 : Math.max(MAX_ALBUM_SIZE - result.kept.length, 0);
}
