import type {
  ChatActivity,
  IslandOriginal,
  Message,
  MessageAttachment,
  QuotedMessage,
} from '@/api/chats';
import type { LocalMedia, MediaLibraryItem } from '@/features/media';

export type DeliveryStatus = 'sending' | 'sent' | 'failed';

export type ChatMessage = Message & {
  status: DeliveryStatus;
  /** Set only while the message exists optimistically, before the server id. */
  localId?: string;
  /** Исходный выбор из галереи — нужен только для повтора неудачной отправки. */
  pendingMedia?: MediaLibraryItem[];
  /** Записанное голосовое до ответа сервера — для повтора неудачной отправки. */
  pendingVoice?: LocalMedia;
  /**
   * Островок до ответа сервера: откуда пересылают и какие оригиналы, по
   * порядку. Уходит на сервер одним вызовом — и повторяется им же.
   */
  pendingForward?: { sourceChatId: string; messageIds: string[] };
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
  /** Оставленные фото и видео — по порядку. */
  kept: MessageAttachment[];
  /** Добавленные из шита медиа — в конец альбома. */
  added: MediaLibraryItem[];
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
  | { type: 'post'; text: string; media: MediaLibraryItem[]; replyTo: string[] }
  | { type: 'voice'; voice: LocalMedia; replyTo: string[] }
  | { type: 'forward'; sourceChatId: string; messageIds: string[] }
  /** Пересланный комментарий — по сообщению на комментарий. */
  | { type: 'forward_comment'; commentId: string };

export type UserActivity = { userId: string; activity: ChatActivity };
