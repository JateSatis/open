import type {
  ChatActivity,
  IslandOriginal,
  Message,
  MessageAttachment,
  QuotedMessage,
  SendMessageMedia,
  SendVoiceInput,
} from '@/api/chats';
import type { DraftPop } from '@/features/chats/composerDraftStore';
import type { LocalMedia, OutgoingMedia } from '@/features/media';
import type { HiddenRange } from '@/features/chats/hiddenText';

export type DeliveryStatus = 'sending' | 'sent' | 'failed';

export type ChatMessage = Message & {
  status: DeliveryStatus;
  /** Set only while the message exists optimistically, before the server id. */
  localId?: string;
  /** Keeps mounted forward rows stable when the server confirms their parent id. */
  renderId?: string;
  /** Автор оптимистичного ответа на плашке треда; серверную сводку не меняет. */
  chatThreadPendingAuthor?: { id: string; name: string; avatarUrl: string | null };
  /** Исходный выбор из галереи — нужен только для повтора неудачной отправки. */
  pendingMedia?: OutgoingMedia[];
  /** Записанное голосовое до ответа сервера — для повтора неудачной отправки. */
  pendingVoice?: LocalMedia;
  /**
   * Островок до ответа сервера: откуда пересылают и какие оригиналы, по
   * порядку. Уходит на сервер одним вызовом — и повторяется им же.
   */
  pendingForward?: { sourceChatId: string; messageIds: string[] };
  /** Пост с попом до ответа сервера: канал и поп — уже опубликованный или новый. */
  pendingPop?: { channelId: string; pop: DraftPop };
  /**
   * Заметка из «Сохранённых» до ответа сервера: её файлы уже в Storage и
   * очищены — повтор отправляет их же, не загружая заново.
   */
  pendingFiles?: Extract<Outgoing, { type: 'files' }>;
  /**
   * Локальные превью вложений своего только что отправленного сообщения, по
   * позициям. Переживают ответ сервера: плитка держит локальную картинку,
   * пока грузится удалённая, и не мигает пустотой.
   */
  localPreviews?: string[];
  /** Правка ушла на сервер и ещё не подтверждена: облачко уже показывает новую версию. */
  editStatus?: 'saving';
};

/** Голосовое итога правки: прежняя запись или новая, ещё на телефоне. */
export type EditVoice =
  | { type: 'kept'; attachment: MessageAttachment; localUri?: string }
  | { type: 'new'; voice: LocalMedia };

/** Итог правки до загрузки новых файлов. */
export type EditResult = {
  text: string;
  /** Скрытое от зрителей в новом тексте — code points. */
  hidden?: HiddenRange[];
  /** Оставленные фото и видео — по порядку. */
  kept: MessageAttachment[];
  /** Добавленные из шита медиа — в конец альбома. */
  added: OutgoingMedia[];
  voice: EditVoice | null;
};

/** Цитата, на которую можно ответить: оригинал жив. */
export type LiveQuote = Extract<QuotedMessage, { state: 'live' }>;

/**
 * Что пересылается — оригинал целиком, с автором и чатом: островок в целевом
 * чате появляется сразу, до ответа сервера, и рисует его как есть.
 */
export type ForwardItem = { original: IslandOriginal };

/** Что уходит на сервер одной отправкой: текст с альбомом, голосовое или пересылка. */
export type Outgoing =
  | {
      type: 'post';
      text: string;
      media: OutgoingMedia[];
      replyTo: string[];
      replyVia?: Record<string, string>;
      /** Скрытое от зрителей в `text` — code points. */
      hidden?: HiddenRange[];
    }
  | { type: 'voice'; voice: LocalMedia; replyTo: string[]; replyVia?: Record<string, string> }
  /** Пост канала с попом; новый поп публикуется той же транзакцией. */
  | { type: 'pop_post'; text: string; replyTo: string[]; channelId: string; pop: DraftPop }
  | { type: 'forward'; sourceChatId: string; messageIds: string[] }
  /** Пересланный комментарий — по сообщению на комментарий. */
  | { type: 'forward_comment'; commentId: string }
  /** Заметка из «Сохранённых» — обычным сообщением, её готовыми файлами. */
  | { type: 'files'; text: string; media: SendMessageMedia[]; voice: SendVoiceInput | null };

export type UserActivity = { userId: string; activity: ChatActivity };
