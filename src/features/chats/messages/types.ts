import type { ChatActivity, Message } from '@/api/chats';
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
   * Локальные превью вложений своего только что отправленного сообщения, по
   * позициям. Переживают ответ сервера: плитка держит локальную картинку,
   * пока грузится удалённая, и не мигает пустотой.
   */
  localPreviews?: string[];
};

/** Что уходит на сервер одной отправкой: текст с альбомом или голосовое. */
export type Outgoing =
  { type: 'post'; text: string; media: MediaLibraryItem[] } | { type: 'voice'; voice: LocalMedia };

export type UserActivity = { userId: string; activity: ChatActivity };
