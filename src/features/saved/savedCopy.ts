import type { ChatSummary, QuotedMessage } from '@/api/chats';
import { toPreview } from '@/api/messagePreview';
import { NO_REACTIONS } from '@/api/reactionCounts';
import type { SavedMessage, SavedQuote } from '@/api/saved';
import { chatAvatarUrl, chatTitle } from '@/features/chats/chatDisplay';
import { formatMessagesForCopy } from '@/features/chats/copyMessages';
import { DELETED_ACCOUNT } from '@/features/chats/messageQuote';
import type { ChatMessage, DeliveryStatus, LiveQuote } from '@/features/chats/messages/types';

/** Подпись своей заметки вместо источника. */
export const NOTE_AUTHOR = 'Вы';

/**
 * Запись списка «Сохранённых»: с сервера или своя заметка, которую он ещё
 * не подтвердил (`localId`) — с часиками или «не отправлено».
 */
export type SavedItem = SavedMessage & {
  status?: DeliveryStatus;
  localId?: string;
  /** Правка заметки едет на сервер — облачко уже показывает новую версию. */
  editStatus?: 'saving';
  /**
   * Локальные файлы только что написанной заметки по позициям: плитка держит
   * их, пока грузится удалённая, и не мигает пустотой.
   */
  localPreviews?: string[];
  /** Цитаты неподтверждённой заметки — как их показала плашка ответа. */
  pendingQuotes?: QuotedMessage[];
};

export function isNote(saved: SavedMessage): boolean {
  return saved.sourceType === 'note';
}

/** Ещё не подтверждённая сервером заметка: с ней только «Повторить» и «Удалить». */
export function isPendingNote(saved: SavedItem): boolean {
  return saved.localId !== undefined;
}

/**
 * Копия как сообщение, которое понимает облачко переписки: без реакций,
 * комментариев, просмотров и правок — только снимок содержимого и время
 * оригинала, если оно было видно.
 */
export function toBubbleMessage(saved: SavedItem, replies: QuotedMessage[] = []): ChatMessage {
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
    edited: saved.edited,
    editMark: null,
    attachments: saved.attachments,
    replies,
    forward: null,
    reactions: NO_REACTIONS,
    commentsCount: 0,
    viewsCount: 0,
    readAt: null,
    status: saved.status ?? 'sent',
    localId: saved.localId,
    editStatus: saved.editStatus,
    localPreviews: saved.localPreviews,
  };
}

/** Чем подписана цитата: «Вы» у заметки, иначе источник записи. */
function quoteAuthor(
  quote: Extract<SavedQuote, { savedId: string }>,
  chats: ReadonlyMap<string, ChatSummary>,
  currentUserId: string | null,
): string {
  if (quote.sourceType === 'note') return NOTE_AUTHOR;

  const chat = quote.sourceChatId ? chats.get(quote.sourceChatId) : undefined;

  return chat ? chatTitle(chat, currentUserId) : 'Удалённый чат';
}

/**
 * Цитаты ответа заметки — как цитаты облачка переписки. Удалённая — заглушка,
 * её «id» — место в ответе: по нему ни перехода, ни совпадений.
 */
export function savedQuotesOf(
  saved: SavedItem,
  chats: ReadonlyMap<string, ChatSummary>,
  currentUserId: string | null,
): QuotedMessage[] {
  if (saved.pendingQuotes) return saved.pendingQuotes;

  return saved.replies.map((quote, index): QuotedMessage =>
    quote.savedId === null
      ? { messageId: `deleted:${saved.id}:${index}`, state: 'deleted' }
      : {
          messageId: quote.savedId,
          state: 'live',
          authorId: null,
          authorName: quoteAuthor(quote, chats, currentUserId),
          seq: quote.seq,
          createdAt: null,
          editMark: null,
          preview: toPreview(quote.kind, quote.text, quote.attachments),
        },
  );
}

/** Цитата для плашки ответа: запись, как она сейчас на экране. */
export function savedReplyQuote(
  saved: SavedMessage,
  chats: ReadonlyMap<string, ChatSummary>,
  currentUserId: string | null,
): LiveQuote {
  const label = savedSourceLabel(
    saved,
    saved.sourceChatId ? chats.get(saved.sourceChatId) : undefined,
    currentUserId,
  );
  const [quote] = savedQuotesOf(
    {
      ...saved,
      replies: [
        {
          savedId: saved.id,
          seq: saved.seq,
          sourceType: saved.sourceType,
          sourceChatId: saved.sourceChatId,
          category: saved.category,
          kind: saved.kind,
          text: saved.text,
          attachments: saved.attachments.map((attachment, position) => ({
            url: attachment.hidden ? null : attachment.url,
            poster_url: attachment.posterUrl,
            mime_type: attachment.mimeType,
            duration_ms: attachment.durationMs,
            position,
            pop_id: attachment.popId ?? null,
          })),
        },
      ],
    },
    chats,
    currentUserId,
  );

  return { ...(quote as LiveQuote), authorName: label.source };
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
  if (isNote(saved)) {
    return {
      source: NOTE_AUTHOR,
      author: null,
      avatarUrl: saved.authorAvatarUrl,
      avatarName: saved.authorName ?? NOTE_AUTHOR,
    };
  }

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
