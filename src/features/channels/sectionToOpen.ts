import type { ChatSummary } from '@/api/chats';
import type { ChannelSection } from '@/features/channels/useMarkChannelSectionRead';

/**
 * С какого раздела открыть канал из «Чатов»: где свежее непрочитанное. Новый
 * поп свежее поста — «Попсы», иначе «Посты»; непрочитанного нет — «Посты».
 */
export function sectionToOpen(chat: ChatSummary): ChannelSection {
  const unread = chat.subscription;

  if (!unread || unread.unreadPops === 0) return 'posts';
  if (unread.unreadPosts === 0) return 'pops';

  return chat.lastPopAt !== null &&
    (chat.lastMessageAt === null || chat.lastPopAt > chat.lastMessageAt)
    ? 'pops'
    : 'posts';
}
