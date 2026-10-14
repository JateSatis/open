// Кто и где может войти в режим фрагментов. Права на реакцию и комментарий к
// фрагменту проверяет база; здесь — только то, что предлагает интерфейс.

import { isLocalMessage } from '@/features/chats/messageActions';
import type { ChatMessage } from '@/features/chats/messages/types';

/**
 * В тексте сообщения можно выделять: отправленное текстовое, подпись к
 * альбому, текст под голосовым. Не системное, не островок, не пересланный
 * комментарий — база такой фрагмент и не примет.
 */
export function hasSelectableText(message: ChatMessage): boolean {
  return (
    !isLocalMessage(message) &&
    (message.kind === 'text' || message.kind === 'media' || message.kind === 'voice') &&
    Boolean(message.text?.trim())
  );
}

/**
 * Тап по облачку переводит его в режим фрагментов. Зритель — всегда, если
 * есть текст. Участник чата и публикующий в канале первым фрагмент не
 * создают: им режим открыт, только когда на тексте уже есть видимый кластер
 * (этап 3 подставит настоящее значение).
 */
export function canEnterFragmentMode({
  message,
  isViewer,
  hasVisibleCluster,
}: {
  message: ChatMessage;
  isViewer: boolean;
  hasVisibleCluster: boolean;
}): boolean {
  if (!hasSelectableText(message)) return false;

  return isViewer || hasVisibleCluster;
}
