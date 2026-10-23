// Отправка своих сообщений: черновик в исходящих сразу, загрузка файлов,
// вставка, перенос подтверждённого в историю. Живёт вне компонентов —
// отправка не должна обрываться, если человек ушёл с экрана чата.

import { notifyManager, type QueryClient } from '@tanstack/react-query';

import {
  deleteMessages,
  forwardComments,
  forwardMessages,
  publishPopPost,
  sendMessage,
  sendPopPost as sendPopPostOnServer,
  sendVoiceMessage,
  type ChatRef,
  type ForwardedComment,
  type Message,
  type MessageAttachment,
  type SendMessageMedia,
} from '@/api/chats';
import { PENDING_SEQ } from '@/api/pendingSeq';
import { MAX_ALBUM_SIZE } from '@/features/chats/lib/mosaicLayout';
import { mergeMessages, updateHistory } from '@/features/chats/messages/historyCache';
import {
  addToOutbox,
  findOutboxMessage,
  removeFromOutbox,
  setOutboxStatus,
  useOutbox,
} from '@/features/chats/messages/outbox';
import type {
  ChatMessage,
  ForwardItem,
  LiveQuote,
  Outgoing,
} from '@/features/chats/messages/types';
import { chatsQueryKey } from '@/features/chats/useChats';
import { reportRequestFailed } from '@/features/connection/connectionStore';
import {
  mediaRejectionText,
  outgoingLocalMedia,
  outgoingPreview,
  removePublicMedia,
  removeUploadedMedia,
  storedPaths,
  uploadAllMedia,
  type LocalMedia,
  type OutgoingMedia,
  type UploadedMedia,
} from '@/features/media';
import { showNotice } from '@/features/notifications/alertsStore';
import { popsQueryKey } from '@/features/pops/keys';
import { PopPosterError, toPopMedia, uploadPop } from '@/features/pops/uploadPop';
import type { DraftPop } from '@/features/chats/composerDraftStore';
import { isNetworkError } from '@/lib/network';
import { NO_REACTIONS } from '@/api/reactionCounts';
import { trimWithRanges, type HiddenRange } from '@/features/chats/hiddenText';

let localIdCounter = 0;
let pendingSeqCounter = 0;

/** Номер неподтверждённого: выше любого настоящего, по порядку создания. */
function nextPendingSeq(): number {
  pendingSeqCounter += 1;
  return PENDING_SEQ + pendingSeqCounter;
}

export function nextLocalId(): string {
  localIdCounter += 1;
  return `local-${Date.now()}-${localIdCounter}`;
}

// Связь может мигать чаще, чем успевает отработать одна отправка (особенно
// с медиа — загрузка файлов идёт заметно дольше вставки текста), и тогда
// повтор по «связь вернулась» стартовал бы поверх ещё не завершившейся
// попытки той же отправки — сообщение ушло бы в чат дважды. Ключ отправки —
// localId.
const delivering = new Set<string>();
// Человек удалил своё неотправленное, пока оно ещё ехало на сервер.
const discarded = new Set<string>();

/**
 * Локальный предпросмотр вложения до ответа сервера — облачко не пустует,
 * пока файлы грузятся. У отредактированного фото — сразу итоговая картинка.
 */
export function toLocalAttachment(asset: OutgoingMedia): MessageAttachment {
  const preview = outgoingPreview(asset);

  return {
    id: asset.id,
    url: preview.url,
    posterUrl: null,
    mimeType: asset.kind === 'video' ? 'video/mp4' : 'image/jpeg',
    width: preview.width,
    height: preview.height,
    durationMs: asset.durationMs,
    waveform: null,
  };
}

/** Своё голосовое до ответа сервера: играет локальный файл, волна уже есть. */
export function toLocalVoiceAttachment(localId: string, voice: LocalMedia): MessageAttachment {
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

/** Что повторить для упавшего сообщения. Пересылка повторяется целиком, одним вызовом. */
export function outgoingOf(message: ChatMessage): Outgoing | null {
  const replyTo = message.replies.map((quote) => quote.messageId);

  if (message.pendingForward) return { type: 'forward', ...message.pendingForward };

  if (message.kind === 'comment_forward') {
    const commentId = message.commentForward?.commentId;

    return commentId ? { type: 'forward_comment', commentId } : null;
  }

  if (message.pendingVoice) return { type: 'voice', voice: message.pendingVoice, replyTo };

  if (message.pendingPop) {
    return { type: 'pop_post', text: message.text ?? '', replyTo, ...message.pendingPop };
  }

  const text = message.text ?? '';
  const media = message.pendingMedia ?? [];

  return text || media.length > 0
    ? { type: 'post', text, media, replyTo, hidden: message.hiddenRanges }
    : null;
}

export function toSendMedia(item: UploadedMedia): SendMessageMedia {
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
  media: OutgoingMedia[],
): { text: string; media: OutgoingMedia[] }[] {
  if (media.length <= MAX_ALBUM_SIZE) return [{ text, media }];

  const parts: { text: string; media: OutgoingMedia[] }[] = [];

  for (let start = 0; start < media.length; start += MAX_ALBUM_SIZE) {
    parts.push({
      text: start === 0 ? text : '',
      media: media.slice(start, start + MAX_ALBUM_SIZE),
    });
  }

  return parts;
}

/**
 * Файлы нового попа, уже лежащие в Storage, по id попа. `publish_pop` с тем же
 * id идемпотентен: если ответ потерялся, а транзакция прошла, поп ссылается
 * именно на эти файлы — повтор не льёт новые и не удаляет эти.
 */
const uploadedPops = new Map<string, UploadedMedia>();

/** Файлы отправки — в Storage, в свой префикс. Ими же пользуются комментарии. */
export async function uploadOutgoing(
  outgoing: Outgoing,
  currentUserId: string,
): Promise<UploadedMedia[]> {
  if (outgoing.type === 'forward' || outgoing.type === 'forward_comment') return [];
  if (outgoing.type === 'pop_post') {
    if (outgoing.pop.type === 'existing') return [];

    // Повтор — теми же файлами: поп с этим id мог уже создаться и ссылаться на них.
    const known = uploadedPops.get(outgoing.pop.popId);
    const uploaded = known ?? (await uploadPop(newPopMedia(outgoing.pop), currentUserId));

    uploadedPops.set(outgoing.pop.popId, uploaded);

    return [uploaded];
  }
  if (outgoing.type === 'voice') return uploadAllMedia([outgoing.voice], currentUserId);
  if (outgoing.media.length === 0) return [];

  return uploadAllMedia(await Promise.all(outgoing.media.map(outgoingLocalMedia)), currentUserId);
}

/** Новый поп черновика — видео на устройстве, как его знает загрузка. */
function newPopMedia(pop: Extract<DraftPop, { type: 'new' }>): LocalMedia {
  return {
    kind: 'video',
    uri: pop.uri,
    mimeType: pop.mimeType,
    width: pop.width,
    height: pop.height,
    durationMs: pop.durationMs,
  };
}

async function insert(
  chatId: string,
  outgoing: Outgoing,
  uploaded: UploadedMedia[],
): Promise<Message> {
  if (outgoing.type === 'pop_post') {
    const { pop } = outgoing;

    if (pop.type === 'existing') {
      return sendPopPostOnServer(chatId, pop.pop.id, outgoing.text || null, outgoing.replyTo);
    }

    // Новый поп публикуется вместе с постом, без подписи: текст — у поста.
    return publishPopPost({
      channelId: outgoing.channelId,
      popId: pop.popId,
      title: pop.title,
      media: toPopMedia(uploaded[0], newPopMedia(pop)),
      postText: outgoing.text || null,
      replyTo: outgoing.replyTo,
    });
  }

  if (outgoing.type === 'forward') {
    // Островок ничего не копирует: ссылки на оригиналы, файлы — их.
    return forwardMessages(chatId, outgoing.sourceChatId, outgoing.messageIds);
  }

  if (outgoing.type === 'forward_comment') {
    const [message] = await forwardComments(chatId, [outgoing.commentId]);

    return message;
  }

  if (outgoing.type === 'voice') {
    const [file] = uploaded;

    return sendVoiceMessage(
      chatId,
      {
        url: file.url,
        mimeType: file.mimeType,
        durationMs: file.durationMs ?? 0,
        sizeBytes: file.sizeBytes,
        waveform: file.waveform,
      },
      outgoing.replyTo,
    );
  }

  return sendMessage(chatId, {
    text: outgoing.text || undefined,
    media: uploaded.length > 0 ? uploaded.map(toSendMedia) : undefined,
    replyTo: outgoing.replyTo.length > 0 ? outgoing.replyTo : undefined,
    hidden: outgoing.hidden?.length ? outgoing.hidden : undefined,
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

export function errorCode(cause: unknown): string | null {
  if (typeof cause !== 'object' || cause === null) return null;

  const { code } = cause as { code?: unknown };

  return typeof code === 'string' ? code : null;
}

/**
 * Отказ, который повтор не исправит, — объяснить человеку, что случилось.
 * Сырые ошибки базы в интерфейс не попадают.
 */
function explainRejection(outgoing: Outgoing, cause: unknown) {
  const code = errorCode(cause);

  if (code === 'P0002') {
    showNotice(
      outgoing.type === 'forward'
        ? 'Не удалось переслать: сообщение уже удалено'
        : outgoing.type === 'forward_comment'
          ? 'Не удалось переслать: комментарий удалён'
          : 'Не отправлено: сообщение, на которое вы отвечаете, удалено',
      'error',
    );
  }

  if (cause instanceof PopPosterError) {
    showNotice('Не удалось снять обложку видео. Повторите или выберите другое.', 'error');
  }

  const media = mediaRejectionText(cause);

  if (media) showNotice(media, 'error');

  if (code === '42501' && outgoing.type === 'pop_post') {
    showNotice('Публиковать в канале может только его автор', 'error');
  }

  if (code === '42501' && outgoing.type === 'forward_comment') {
    showNotice('Переслать сюда может только участник чата', 'error');
  }

  // Пересылаемое ушло из исходного чата раньше, чем островок доехал: его
  // убрали из островка, откуда пересылали.
  if (code === '42501' && outgoing.type === 'forward') {
    showNotice('Не удалось переслать: этих сообщений больше нет в чате', 'error');
  }
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
    const hasFiles =
      outgoing.type === 'voice' ||
      (outgoing.type === 'post' && outgoing.media.length > 0) ||
      (outgoing.type === 'pop_post' && outgoing.pop.type === 'new');

    // Без своего id файлы заливать некуда (путь в Storage строится от него) —
    // явный сбой лучше, чем сообщение, которое молча потеряло вложения.
    if (hasFiles && !currentUserId) throw new Error('Нет активной сессии');

    uploaded = hasFiles ? await uploadOutgoing(outgoing, currentUserId!) : [];

    if (discarded.has(localId)) throw new Error('Отправка отменена');

    saved = await insert(chatId, outgoing, uploaded);

    // Уже в базе, но человек его удалил — удаляем и там. Удаление мягкое и
    // разослано всем, так что у собеседника оно тоже исчезнет.
    if (discarded.has(localId)) {
      void deleteMessages([saved.id]).catch(() => undefined);
    } else {
      settle(queryClient, chatId, localId, saved);
    }

    if (outgoing.type === 'pop_post' && outgoing.pop.type === 'new') {
      uploadedPops.delete(outgoing.pop.popId);
    }

    // Список чатов держит последнее сообщение и порядок — после отправки он
    // устарел, хотя сама переписка на экране уже верна.
    void queryClient.invalidateQueries({ queryKey: chatsQueryKey });

    // Новый поп из «Постов» появился и в «Попсах» канала.
    if (outgoing.type === 'pop_post' && outgoing.pop.type === 'new') {
      void queryClient.invalidateQueries({ queryKey: popsQueryKey(outgoing.channelId) });
    }
  } catch (cause) {
    // Сообщение в базу не попало (или упало на середине) — загруженные файлы
    // теперь ничьи, оставлять их в Storage незачем.
    // Исключение — сервер не ответил (обрыв, срок запроса): сообщение или
    // новый поп могли создаться, и удалить их файлы значило бы оставить в
    // переписке облачко с пустыми вложениями. Лишний файл в бакете дешевле.
    const unanswered = isNetworkError(cause);

    if (!saved && uploaded.length > 0 && !unanswered) {
      // Видео нового попа — в публичном `media`, медиа сообщения — в `chat-media`.
      const remove = outgoing.type === 'pop_post' ? removePublicMedia : removeUploadedMedia;

      void Promise.all(uploaded.map((item) => remove(storedPaths(item))));

      if (outgoing.type === 'pop_post' && outgoing.pop.type === 'new') {
        uploadedPops.delete(outgoing.pop.popId);
      }
    }

    if (discarded.has(localId)) return;

    // Не дошло до сервера — это факт о связи, а не только об этом сообщении:
    // с него и начинается ожидание сети.
    if (isNetworkError(cause)) reportRequestFailed();
    else explainRejection(outgoing, cause);

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

function textDraft(
  { chatId, currentUserId }: SendContext,
  text: string,
  at: number,
  replies: LiveQuote[] = [],
  hidden: HiddenRange[] = [],
): ChatMessage {
  const localId = nextLocalId();

  return {
    id: localId,
    localId,
    chatId,
    authorId: currentUserId,
    kind: 'text',
    text,
    hiddenRanges: hidden,
    seq: nextPendingSeq(),
    createdAt: new Date(at).toISOString(),
    editedAt: null,
    edited: false,
    editMark: null,
    reactions: NO_REACTIONS,
    commentsCount: 0,
    viewsCount: 0,
    readAt: null,
    attachments: [],
    replies,
    forward: null,
    status: 'sending',
  };
}

export function sendPost(
  context: SendContext,
  text: string,
  media: OutgoingMedia[] = [],
  replies: LiveQuote[] = [],
  hidden: HiddenRange[] = [],
) {
  const { queryClient, chatId, currentUserId } = context;
  // Скрытое — в смещениях обрезанного текста: так его сохранит база.
  const { text: trimmed, ranges } = trimWithRanges(text, hidden);

  if (!trimmed && media.length === 0) return;

  // Одна мозаика вмещает не больше MAX_ALBUM_SIZE файлов — остальные уходят
  // следующими сообщениями, в порядке выбора. Подпись и ответ — у первого.
  const parts = splitIntoAlbums(trimmed, media);
  const now = Date.now();
  const drafts: ChatMessage[] = parts.map((part, index) => {
    const partReplies = index === 0 ? replies : [];
    // Подпись — у первой части, и скрытое в ней тоже.
    const partHidden = index === 0 && part.text ? ranges : [];

    if (part.media.length === 0) {
      return textDraft(context, part.text, now + index, partReplies, partHidden);
    }

    const localId = nextLocalId();
    const attachments = part.media.map(toLocalAttachment);

    return {
      id: localId,
      localId,
      chatId,
      authorId: currentUserId,
      kind: 'media',
      text: part.text || null,
      hiddenRanges: partHidden,
      // Миллисекунда между частями держит их порядок в списке.
      seq: nextPendingSeq(),
      createdAt: new Date(now + index).toISOString(),
      editedAt: null,
      edited: false,
      editMark: null,
      reactions: NO_REACTIONS,
      commentsCount: 0,
      viewsCount: 0,
      readAt: null,
      attachments,
      replies: partReplies,
      forward: null,
      pendingMedia: part.media,
      localPreviews: attachments.map((attachment) => attachment.url),
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
    for (const draft of drafts) {
      const outgoing = outgoingOf(draft);

      if (outgoing) await deliver(queryClient, chatId, currentUserId, draft.localId!, outgoing);
    }
  })();
}

export function sendVoice(
  { queryClient, chatId, currentUserId }: SendContext,
  voice: LocalMedia,
  replies: LiveQuote[] = [],
) {
  const localId = nextLocalId();
  const draft: ChatMessage = {
    id: localId,
    localId,
    chatId,
    authorId: currentUserId,
    kind: 'voice',
    text: null,
    seq: nextPendingSeq(),
    createdAt: new Date().toISOString(),
    editedAt: null,
    edited: false,
    editMark: null,
    reactions: NO_REACTIONS,
    commentsCount: 0,
    viewsCount: 0,
    readAt: null,
    attachments: [toLocalVoiceAttachment(localId, voice)],
    replies,
    forward: null,
    pendingVoice: voice,
    // Своё голосовое и после отправки играет из локального файла:
    // скачивать только что записанное обратно незачем.
    localPreviews: [voice.uri],
    status: 'sending',
  };

  // Облачко с плеером — сразу, до загрузки: это мессенджер.
  addToOutbox(chatId, [draft]);
  void deliver(queryClient, chatId, currentUserId, localId, {
    type: 'voice',
    voice,
    replyTo: replies.map((quote) => quote.messageId),
  });
}

/**
 * Пересылка, как в Telegram: текст из поля, если он есть, уходит отдельным
 * сообщением перед островком. Островок появляется сразу — с оригиналами, как
 * их видно в исходном чате, — и уходит на сервер одним вызовом. Порядок
 * облачков — порядок `items`: как сообщения стояли на экране.
 */
export function sendForward(
  context: SendContext,
  text: string,
  sourceChat: ChatRef,
  items: ForwardItem[],
) {
  const { queryClient, chatId, currentUserId } = context;

  if (items.length === 0) return;

  const trimmed = text.trim();
  const now = Date.now();
  const lead = trimmed ? textDraft(context, trimmed, now) : null;
  const localId = nextLocalId();
  const messageIds = items.map((item) => item.original.id);
  const island: ChatMessage = {
    id: localId,
    localId,
    chatId,
    authorId: currentUserId,
    kind: 'forward',
    text: null,
    seq: nextPendingSeq(),
    createdAt: new Date(now + 1).toISOString(),
    editedAt: null,
    edited: false,
    editMark: null,
    reactions: NO_REACTIONS,
    commentsCount: 0,
    viewsCount: 0,
    readAt: null,
    attachments: [],
    replies: [],
    forward: {
      sourceChat,
      items: items.map((item, position) => ({
        id: `${localId}-${position}`,
        position,
        messageId: item.original.id,
        original: item.original,
      })),
    },
    pendingForward: { sourceChatId: sourceChat.id, messageIds },
    status: 'sending',
  };

  addToOutbox(chatId, lead ? [island, lead] : [island]);

  void (async () => {
    if (lead) {
      await deliver(queryClient, chatId, currentUserId, lead.localId!, {
        type: 'post',
        text: trimmed,
        media: [],
        replyTo: [],
      });
    }

    await deliver(queryClient, chatId, currentUserId, localId, {
      type: 'forward',
      sourceChatId: sourceChat.id,
      messageIds,
    });
  })();
}

/**
 * Пересылка комментариев: текст из поля, если он есть, — отдельным
 * сообщением перед ними, затем по облачку на комментарий, в порядке панели.
 * Облачка появляются сразу, с комментарием как его видно в панели, и уходят
 * на сервер по очереди: порядок в переписке держит время.
 */
export function sendCommentForward(
  context: SendContext,
  text: string,
  comments: ForwardedComment[],
) {
  const { queryClient, chatId, currentUserId } = context;

  if (comments.length === 0) return;

  const trimmed = text.trim();
  const now = Date.now();
  const lead = trimmed ? textDraft(context, trimmed, now) : null;
  const drafts = comments.map((comment, index): ChatMessage => {
    const localId = nextLocalId();

    return {
      id: localId,
      localId,
      chatId,
      authorId: currentUserId,
      kind: 'comment_forward',
      text: null,
      seq: nextPendingSeq(),
      createdAt: new Date(now + 1 + index).toISOString(),
      editedAt: null,
      edited: false,
      editMark: null,
      reactions: NO_REACTIONS,
      commentsCount: 0,
      viewsCount: 0,
      readAt: null,
      attachments: [],
      replies: [],
      forward: null,
      commentForward: { commentId: comment.id, comment },
      status: 'sending',
    };
  });

  // Список новыми вперёд: последний пересланный — сверху.
  addToOutbox(chatId, [...drafts].reverse().concat(lead ? [lead] : []));

  void (async () => {
    if (lead) {
      await deliver(queryClient, chatId, currentUserId, lead.localId!, {
        type: 'post',
        text: trimmed,
        media: [],
        replyTo: [],
      });
    }

    for (const draft of drafts) {
      await deliver(queryClient, chatId, currentUserId, draft.localId!, {
        type: 'forward_comment',
        commentId: draft.commentForward!.commentId!,
      });
    }
  })();
}

/**
 * Пост канала с попом. Облачко с обложкой — сразу, до загрузки; новый поп
 * публикуется вместе с постом и появляется в «Попсах».
 */
export function sendPopPost(
  context: SendContext,
  channelId: string,
  text: string,
  pop: DraftPop,
  replies: LiveQuote[] = [],
) {
  const { queryClient, chatId, currentUserId } = context;
  const localId = nextLocalId();
  const trimmed = text.trim();
  const attachment: MessageAttachment =
    pop.type === 'existing'
      ? {
          id: `${localId}-pop`,
          url: pop.pop.url,
          posterUrl: pop.pop.posterUrl,
          mimeType: pop.pop.mimeType,
          width: pop.pop.width,
          height: pop.pop.height,
          durationMs: pop.pop.durationMs,
          waveform: null,
          popId: pop.pop.id,
        }
      : {
          id: `${localId}-pop`,
          url: pop.uri,
          posterUrl: pop.posterUri,
          mimeType: pop.mimeType,
          width: pop.width,
          height: pop.height,
          durationMs: pop.durationMs,
          waveform: null,
          popId: pop.popId,
        };
  const draft: ChatMessage = {
    id: localId,
    localId,
    chatId,
    authorId: currentUserId,
    kind: 'media',
    text: trimmed || null,
    seq: nextPendingSeq(),
    createdAt: new Date().toISOString(),
    editedAt: null,
    edited: false,
    editMark: null,
    reactions: NO_REACTIONS,
    commentsCount: 0,
    viewsCount: 0,
    readAt: null,
    attachments: [attachment],
    replies,
    forward: null,
    pendingPop: { channelId, pop },
    // Обложка не мигает пустотой, пока грузится удалённый постер.
    localPreviews: attachment.posterUrl ? [attachment.posterUrl] : undefined,
    status: 'sending',
  };

  addToOutbox(chatId, [draft]);
  void deliver(queryClient, chatId, currentUserId, localId, {
    type: 'pop_post',
    text: trimmed,
    replyTo: replies.map((quote) => quote.messageId),
    channelId,
    pop,
  });
}
