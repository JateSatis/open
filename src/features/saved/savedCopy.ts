import type { ChatSummary } from '@/api/chats';
import { NO_REACTIONS } from '@/api/reactionCounts';
import type { SavedMessage } from '@/api/saved';
import { chatAvatarUrl, chatTitle } from '@/features/chats/chatDisplay';
import { formatMessagesForCopy } from '@/features/chats/copyMessages';
import { DELETED_ACCOUNT } from '@/features/chats/messageQuote';
import type { ChatMessage } from '@/features/chats/messages/types';

/**
 * Копия как сообщение, которое понимает облачко переписки: без реакций,
 * комментариев, просмотров и правок — только снимок содержимого и время
 * оригинала, если оно было видно.
 */
export function toBubbleMessage(saved: SavedMessage): ChatMessage {
  return {
    id: saved.id,
    chatId: saved.sourceChatId ?? '',
    authorId: saved.authorId,
    authorOpaque: saved.authorOpaque,
    kind: saved.kind,
    text: saved.text,
    hiddenRanges: [],
    seq: saved.seq,
    createdAt: saved.originalAt,
    editedAt: null,
    edited: false,
    editMark: null,
    attachments: saved.attachments,
    replies: [],
    forward: null,
    reactions: NO_REACTIONS,
    commentsCount: 0,
    viewsCount: 0,
    readAt: null,
    status: 'sent',
  };
}

/** Чем подписан пузырь сверху: источник — живой, автор — глазами владельца. */
export type SavedSourceLabel = {
  /** Название чата или канала, как в «Чатах»; чат удалён — «Удалённый чат». */
  source: string;
  /** У поста канала автора нет: пост — от канала. */
  author: string | null;
  avatarUrl: string | null;
  /** Аватар без фото — по этому имени. */
  avatarName: string;
};

export function savedSourceLabel(
  saved: SavedMessage,
  chat: ChatSummary | undefined,
  currentUserId: string | null,
): SavedSourceLabel {
  const source = chat ? chatTitle(chat, currentUserId) : 'Удалённый чат';
  const channelPost = saved.sourceType === 'message' && saved.category === 'channel';
  const author = channelPost ? null : (saved.authorName ?? DELETED_ACCOUNT);

  return {
    source,
    author,
    avatarUrl: channelPost
      ? chat
        ? chatAvatarUrl(chat, currentUserId)
        : null
      : saved.authorAvatarUrl,
    avatarName: author ?? source,
  };
}

/**
 * Тексты выбранного одним блоком, как в чате (`formatMessagesForCopy`): у
 * каждой — автор и время оригинала, если оно было видно. Автор у копии —
 * снимок, не участник чата: формат спрашивает имя по id, поэтому id здесь —
 * id записи, а имя берётся из её подписи.
 */
export function formatSavedForCopy(
  items: readonly SavedMessage[],
  chats: ReadonlyMap<string, ChatSummary>,
  currentUserId: string | null,
): string {
  const byId = new Map(items.map((saved) => [saved.id, saved]));

  return formatMessagesForCopy(
    items.map((saved) => ({ ...toBubbleMessage(saved), authorId: saved.id })),
    (id) => {
      const saved = id ? byId.get(id) : undefined;

      if (!saved) return DELETED_ACCOUNT;

      const label = savedSourceLabel(
        saved,
        saved.sourceChatId ? chats.get(saved.sourceChatId) : undefined,
        currentUserId,
      );

      return label.author ?? label.source;
    },
  );
}
