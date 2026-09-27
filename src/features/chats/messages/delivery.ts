// Отправка своих сообщений: черновик в исходящих сразу, загрузка файлов,
// вставка, перенос подтверждённого в историю. Живёт вне компонентов —
// отправка не должна обрываться, если человек ушёл с экрана чата.

import { notifyManager, type QueryClient } from '@tanstack/react-query';

import {
  deleteMessages,
  sendMessage,
  sendVoiceMessage,
  type Message,
  type MessageAttachment,
  type SendMessageMedia,
} from '@/api/chats';
import { MAX_ALBUM_SIZE } from '@/features/chats/lib/mosaicLayout';
import { mergeMessages, updateHistory } from '@/features/chats/messages/historyCache';
import {
  addToOutbox,
  findOutboxMessage,
  removeFromOutbox,
  setOutboxStatus,
  useOutbox,
} from '@/features/chats/messages/outbox';
import type { ChatMessage, Outgoing } from '@/features/chats/messages/types';
import { chatsQueryKey } from '@/features/chats/useChats';
import { reportRequestFailed } from '@/features/connection/connectionStore';
import {
  assetPreviewUri,
  libraryAssetToLocalMedia,
  removeUploadedMedia,
  resolveLibraryAsset,
  storedPaths,
  uploadAllMedia,
  type LocalMedia,
  type MediaLibraryItem,
  type UploadedMedia,
} from '@/features/media';
import { isNetworkError } from '@/lib/network';

let localIdCounter = 0;

function nextLocalId(): string {
  localIdCounter += 1;
  return `local-${Date.now()}-${localIdCounter}`;
}

// Связь может мигать чаще, чем успевает отработать одна отправка (особенно
// с медиа — загрузка файлов идёт заметно дольше вставки текста), и тогда
// повтор по «связь вернулась» стартовал бы поверх ещё не завершившейся
// попытки той же локальной записи — сообщение ушло бы в чат дважды.
const delivering = new Set<string>();
// Человек удалил своё неотправленное, пока оно ещё ехало на сервер.
const discarded = new Set<string>();

/** Локальный предпросмотр вложения до ответа сервера — облачко не пустует, пока файлы грузятся. */
function toLocalAttachment(asset: MediaLibraryItem): MessageAttachment {
  return {
    id: asset.id,
    // Превью берётся по id ассета: путь к файлу для показа не нужен, он
    // понадобится только когда дойдёт до чтения байт.
    url: assetPreviewUri(asset),
    posterUrl: null,
    mimeType: asset.kind === 'video' ? 'video/mp4' : 'image/jpeg',
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
    waveform: null,
  };
}

/** Своё голосовое до ответа сервера: играет локальный файл, волна уже есть. */
function toLocalVoiceAttachment(localId: string, voice: LocalMedia): MessageAttachment {
  return {
    id: `${localId}-voice`,
    url: voice.uri,
    posterUrl: null,
    mimeType: voice.mimeType,
    width: null,
    height: null,
    durationMs: voice.durationMs,
    waveform: voice.waveform ?? null,
  };
}

export function outgoingOf(message: ChatMessage): Outgoing | null {
  if (message.pendingVoice) return { type: 'voice', voice: message.pendingVoice };

  const text = message.text ?? '';
  const media = message.pendingMedia ?? [];

  return text || media.length > 0 ? { type: 'post', text, media } : null;
}

function toSendMedia(item: UploadedMedia): SendMessageMedia {
  return {
    url: item.url,
    posterUrl: item.posterUrl,
    mimeType: item.mimeType,
    width: item.width,
    height: item.height,
    durationMs: item.durationMs,
    sizeBytes: item.sizeBytes,
  };
}

/** Текст и файлы одного сообщения → сообщения по `MAX_ALBUM_SIZE` файлов, подпись у первого. */
export function splitIntoAlbums(
  text: string,
  media: MediaLibraryItem[],
): { text: string; media: MediaLibraryItem[] }[] {
  if (media.length <= MAX_ALBUM_SIZE) return [{ text, media }];

  const parts: { text: string; media: MediaLibraryItem[] }[] = [];

  for (let start = 0; start < media.length; start += MAX_ALBUM_SIZE) {
    parts.push({
      text: start === 0 ? text : '',
      media: media.slice(start, start + MAX_ALBUM_SIZE),
    });
  }

  return parts;
}

async function upload(outgoing: Outgoing, currentUserId: string): Promise<UploadedMedia[]> {
  if (outgoing.type === 'voice') return uploadAllMedia([outgoing.voice], currentUserId);
  if (outgoing.media.length === 0) return [];

  // Пути к файлам могли не успеть резолвиться к моменту выбора — добираем их
  // здесь, там, где байты действительно нужны.
  const resolved = await Promise.all(outgoing.media.map(resolveLibraryAsset));

  return uploadAllMedia(resolved.map(libraryAssetToLocalMedia), currentUserId);
}

function insert(chatId: string, outgoing: Outgoing, uploaded: UploadedMedia[]): Promise<Message> {
  if (outgoing.type === 'voice') {
    const [file] = uploaded;

    return sendVoiceMessage(chatId, {
      url: file.url,
      mimeType: file.mimeType,
      durationMs: file.durationMs ?? 0,
      sizeBytes: file.sizeBytes,
      waveform: file.waveform,
    });
  }

  return sendMessage(chatId, {
    text: outgoing.text || undefined,
    media: uploaded.length > 0 ? uploaded.map(toSendMedia) : undefined,
  });
}

/** Подтверждённое сервером переезжает из исходящих в историю. */
function settle(queryClient: QueryClient, chatId: string, localId: string, saved: Message) {
  const localPreviews = findOutboxMessage(chatId, localId)?.localPreviews;
  const confirmed: ChatMessage = { ...saved, status: 'sent', localPreviews };

  // Свой же broadcast мог прийти раньше ответа на вставку и уже положить это
  // сообщение в историю — тогда ему только достаются локальные превью.
  updateHistory(queryClient, chatId, (history) => {
    const merged = mergeMessages(history, [saved], 'newer');

    return {
      ...merged,
      items: merged.items.map((message) => (message.id === saved.id ? confirmed : message)),
    };
  });

  // Пока история не перерисовалась, в исходящих лежит уже подтверждённая
  // копия под настоящим id: экран склеивает их по id, и сообщение не мигает.
  useOutbox.setState((state) => {
    const current = state.byChat[chatId];

    if (!current) return state;

    return {
      byChat: {
        ...state.byChat,
        [chatId]: current.map((message) =>
          message.localId === localId ? { ...confirmed, localId } : message,
        ),
      },
    };
  });

  // Убрать из исходящих — в том же проходе, в котором подписчики истории
  // узнают о новой строке: один кадр, без дыры между «ушло» и «пришло».
  notifyManager.schedule(() => removeFromOutbox(chatId, localId));
}

export async function deliver(
  queryClient: QueryClient,
  chatId: string,
  currentUserId: string | null,
  localId: string,
  outgoing: Outgoing,
): Promise<void> {
  if (delivering.has(localId)) return;

  delivering.add(localId);
  setOutboxStatus(chatId, localId, 'sending');

  let uploaded: UploadedMedia[] = [];
  let saved: Message | null = null;

  try {
    const hasFiles = outgoing.type === 'voice' || outgoing.media.length > 0;

    // Без своего id файлы заливать некуда (путь в Storage строится от него) —
    // явный сбой лучше, чем сообщение, которое молча потеряло вложения.
    if (hasFiles && !currentUserId) throw new Error('Нет активной сессии');

    uploaded = hasFiles ? await upload(outgoing, currentUserId!) : [];

    if (discarded.has(localId)) throw new Error('Отправка отменена');

    saved = await insert(chatId, outgoing, uploaded);

    if (discarded.has(localId)) {
      // Уже в базе, но человек его удалил — удаляем и там. Удаление мягкое и
      // разослано всем, так что у собеседника оно тоже исчезнет.
      void deleteMessages([saved.id]).catch(() => undefined);
      return;
    }

    settle(queryClient, chatId, localId, saved);
    // Список чатов держит последнее сообщение и порядок — после отправки он
    // устарел, хотя сама переписка на экране уже верна.
    void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
  } catch (cause) {
    // Сообщение в базу не попало (или упало на середине) — загруженные файлы
    // теперь ничьи, оставлять их в Storage незачем.
    if (!saved && uploaded.length > 0) {
      void Promise.all(uploaded.map((item) => removeUploadedMedia(storedPaths(item))));
    }

    if (discarded.has(localId)) return;

    // Не дошло до сервера — это факт о связи, а не только об этом сообщении:
    // с него и начинается ожидание сети.
    if (isNetworkError(cause)) reportRequestFailed();

    // The insert policy on `messages` is what decides whether this user may
    // write here; a rejection lands the message in "failed", it is never
    // dropped silently.
    setOutboxStatus(chatId, localId, 'failed');
  } finally {
    delivering.delete(localId);
    discarded.delete(localId);
  }
}

/**
 * Своё неотправленное — убрать. На сервер ничего не уходит; если сообщение
 * как раз едет туда, оно будет удалено сразу по прибытии.
 */
export function discardLocal(chatId: string, localId: string) {
  if (delivering.has(localId)) discarded.add(localId);

  removeFromOutbox(chatId, localId);
}

type SendContext = { queryClient: QueryClient; chatId: string; currentUserId: string | null };

export function sendPost(
  { queryClient, chatId, currentUserId }: SendContext,
  text: string,
  media: MediaLibraryItem[] = [],
) {
  const trimmed = text.trim();

  if (!trimmed && media.length === 0) return;

  // Одна мозаика вмещает не больше MAX_ALBUM_SIZE файлов — остальные уходят
  // следующими сообщениями, в порядке выбора. Подпись — у первого.
  const parts = splitIntoAlbums(trimmed, media);
  const now = Date.now();
  const drafts: ChatMessage[] = parts.map((part, index) => {
    const localId = nextLocalId();
    const attachments = part.media.map(toLocalAttachment);

    return {
      id: localId,
      localId,
      chatId,
      authorId: currentUserId,
      kind: part.media.length > 0 ? 'media' : 'text',
      text: part.text || null,
      // Миллисекунда между частями держит их порядок в списке.
      createdAt: new Date(now + index).toISOString(),
      attachments,
      pendingMedia: part.media.length > 0 ? part.media : undefined,
      localPreviews: attachments.length > 0 ? attachments.map((a) => a.url) : undefined,
      status: 'sending',
    };
  });

  // Shown before the server answers — this is a messenger, waiting for the
  // round trip before drawing the bubble is not an option. Все части
  // появляются сразу; список новыми вперёд, поэтому последняя часть сверху.
  addToOutbox(chatId, [...drafts].reverse());

  // Части уходят по очереди: параллельная вставка перемешала бы их время на
  // сервере. Каждая при этом падает и повторяется сама по себе.
  void (async () => {
    for (const [index, draft] of drafts.entries()) {
      await deliver(queryClient, chatId, currentUserId, draft.localId!, {
        type: 'post',
        ...parts[index],
      });
    }
  })();
}

export function sendVoice(
  { queryClient, chatId, currentUserId }: SendContext,
  voice: LocalMedia,
) {
  const localId = nextLocalId();
  const draft: ChatMessage = {
    id: localId,
    localId,
    chatId,
    authorId: currentUserId,
    kind: 'voice',
    text: null,
    createdAt: new Date().toISOString(),
    attachments: [toLocalVoiceAttachment(localId, voice)],
    pendingVoice: voice,
    // Своё голосовое и после отправки играет из локального файла:
    // скачивать только что записанное обратно незачем.
    localPreviews: [voice.uri],
    status: 'sending',
  };

  // Облачко с плеером — сразу, до загрузки: это мессенджер.
  addToOutbox(chatId, [draft]);
  void deliver(queryClient, chatId, currentUserId, localId, { type: 'voice', voice });
}
