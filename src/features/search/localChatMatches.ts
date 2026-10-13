import type { ChatSummary } from '@/api/chats';
import type { SearchEntity } from '@/api/search';
import { chatAvatarUrl, chatTitle, counterpart } from '@/features/chats/chatDisplay';
import { matchLevel, normalizeSearch, type ParsedQuery } from '@/features/search/searchText';

/**
 * Блок «Чаты» мгновенно, без сервера: свои чаты из кеша списка «Чатов» по
 * тем же правилам, что у базы, без опечаток. В кеше нет подписок без «в
 * Чатах» и @имён собеседников — их добавит ответ сервера, который сменит
 * этот список, как только придёт.
 */
export function localChatMatches(
  chats: ChatSummary[],
  query: ParsedQuery,
  currentUserId: string | null,
): SearchEntity[] {
  if (!query.text) return [];

  const ranked = chats
    .filter((chat) => query.kind === null || chat.kind === query.kind)
    .map((chat) => {
      const title = chatTitle(chat, currentUserId);
      const username = chat.channel?.username ?? chat.username;
      const usernameLevel = matchLevel(username, query.username);
      const titleLevel = matchLevel(title, query.text);
      const entity: SearchEntity = {
        section: 'mine',
        kind: chat.kind,
        id: chat.channel?.id ?? chat.id,
        chatId: chat.id,
        channelId: chat.channel?.id ?? null,
        personId: counterpart(chat, currentUserId)?.id ?? null,
        title,
        username,
        avatarUrl: chatAvatarUrl(chat, currentUserId),
        subscribed: chat.subscription !== null,
        subscribersCount: chat.subscribersCount,
      };

      return {
        entity,
        first: query.byUsername ? usernameLevel : Math.max(usernameLevel, titleLevel),
        second: query.byUsername ? titleLevel : Math.min(usernameLevel, titleLevel),
        sortTitle: normalizeSearch(title),
      };
    })
    .filter((item) => item.first > 0 || item.second > 0);

  ranked.sort(
    (a, b) =>
      b.first - a.first ||
      b.second - a.second ||
      a.sortTitle.localeCompare(b.sortTitle) ||
      a.entity.id.localeCompare(b.entity.id),
  );

  return ranked.map((item) => item.entity);
}
