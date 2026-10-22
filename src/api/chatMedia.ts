// Фото, видео и голосовые сообщений и комментариев лежат в закрытом бакете
// `chat-media` (миграция `20261102110000_chat_media_access.sql`). У вложения —
// путь в бакете: Storage подписывает ссылку только тому, кому автор открыл
// медиа (участник чата, или по настройке «Кто видит мои фото, видео и
// голосовые»). Зрителю вне области база пути не отдаёт вовсе, а строка
// вложения приходит с `media_hidden`.
//
// Срок подписи короткий: если автор закрыл медиа, уже открытый экран теряет
// доступ к файлу не позже срока, даже не получив сигнала `media_changed`.
// Сами файлы кешируются по пути, поэтому переподпись не качает их заново.

import { createSignedUrlStore, isStoragePath, type SignedEntry } from '@/api/signedUrls';

export const CHAT_MEDIA_BUCKET = 'chat-media';

const store = createSignedUrlStore(CHAT_MEDIA_BUCKET, {
  ttlS: 15 * 60,
  refreshBeforeMs: 3 * 60_000,
  retryAfterMs: 60_000,
});

export type ChatMediaEntry = SignedEntry;

/** Путь в бакете медиа, а не адрес (поп, локальный файл, файл галереи). */
export const isChatMediaPath = isStoragePath;

export const requestChatMediaUrl = store.request;
export const chatMediaEntry = store.entry;
export const chatMediaRefreshDelay = store.refreshDelay;
export const subscribeChatMediaUrls = store.subscribe;

/** Ссылка на файл, когда она нужна сразу (скачать голосовое): null — скрыто или нет сети. */
export const signChatMediaUrl = store.sign;

/** Автор сменил, кому видно медиа: прежние ссылки могли стать чужими. */
export const forgetChatMediaUrls = store.forget;
