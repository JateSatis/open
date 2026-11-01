import type { ChatMessage } from '@/features/chats/messages/types';

/**
 * Ответ ли это в смысле тредов: есть цитата на сообщение этого чата. Цитата
 * оригинала из островка (`via`) треда не создаёт. У подтверждённого решает
 * база (`chatThreadRootIds`), у своего неотправленного — его цитаты.
 */
export function isChatThreadReply(message: ChatMessage): boolean {
  if (message.status === 'sent') return (message.chatThreadRootIds?.length ?? 0) > 0;

  return message.replies.some((quote) => !quote.via);
}
