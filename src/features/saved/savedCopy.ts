import type { ChatSummary } from '@/api/chats';
import { NO_REACTIONS } from '@/api/reactionCounts';
import type { SavedMessage } from '@/api/saved';
import { chatAvatarUrl, chatTitle } from '@/features/chats/chatDisplay';
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
    avatarUrl: channelPost ? (chat ? chatAvatarUrl(chat, currentUserId) : null) : saved.authorAvatarUrl,
    avatarName: author ?? source,
  };
}
