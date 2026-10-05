// Отправка своих комментариев: облачко сразу, со статусом доставки —
// верхнеуровневое наверху списка, ответ в конце своего треда; загрузка
// файлов, вызов функции базы, перенос подтверждённого в кеш. Живёт вне
// компонентов — закрытая панель отправку не обрывает.
//
// Собрано из тех же частей, что и отправка сообщений: локальные превью,
// разбиение альбома, загрузка в Storage, повтор. Своё здесь только то, куда
// комментарий уходит и куда ложится.

import { notifyManager, type QueryClient } from '@tanstack/react-query';

import { deleteComment, sendComment, sendVoiceComment, type Comment } from '@/api/comments';
import { NO_REACTIONS } from '@/api/reactionCounts';
import {
  errorCode,
  nextLocalId,
  outgoingOf,
  splitIntoAlbums,
  toLocalAttachment,
  toLocalVoiceAttachment,
  toSendMedia,
  uploadOutgoing,
} from '@/features/chats/messages/delivery';
import { bumpCommentsCount, updateAllHistories } from '@/features/chats/messages/historyCache';
import type { LiveQuote, Outgoing } from '@/features/chats/messages/types';
import { reportRequestFailed } from '@/features/connection/connectionStore';
import {
  addOutboxComments,
  outboxComments,
  removeOutboxComment,
  setOutboxCommentStatus,
} from '@/features/interactions/comments/commentOutbox';
import type { CommentItem } from '@/features/interactions/comments/commentItem';
import { toCommentItem } from '@/features/interactions/comments/commentItem';
import {
  addToThread,
  pinRoot,
  updateRoots,
  updateThread,
} from '@/features/interactions/comments/commentsCache';
import {
  removeUploadedMedia,
  storedPaths,
  type LocalMedia,
  type MediaLibraryItem,
  type UploadedMedia,
} from '@/features/media';
import { showNotice } from '@/features/notifications/alertsStore';
import { isNetworkError } from '@/lib/network';

export type CommentSendContext = {
  queryClient: QueryClient;
  messageId: string;
  chatId: string;
  currentUserId: string | null;
  /** Имя и аватар — для своего пузыря до ответа сервера. */
  me: { name: string | null; avatarUrl: string | null };
};

/** Ключи отправок, которые сейчас идут: повтор не стартует поверх незавершённой. */
const delivering = new Set<string>();
/** Своё неотправленное удалили, пока оно ехало. */
const discarded = new Set<string>();

function draftOf(
  { messageId, chatId, currentUserId, me }: CommentSendContext,
  at: number,
  content: Pick<CommentItem, 'kind' | 'text' | 'attachments' | 'threadRootId'> &
    Partial<Pick<CommentItem, 'pendingMedia' | 'pendingVoice' | 'localPreviews' | 'replies'>>,
): CommentItem {
  const localId = nextLocalId();

  return {
    id: localId,
    localId,
    chatId,
    messageId,
    authorId: currentUserId,
    authorName: me.name,
    authorAvatarUrl: me.avatarUrl,
    // Ряд знает только база; до её ответа своего пузыря он не касается —
    // пометку «участник» рисуют лишь у чужих.
    audience: 'visitor',
    createdAt: new Date(at).toISOString(),
    editedAt: null,
    replies: [],
    forward: null,
    reactions: NO_REACTIONS,
    commentsCount: 0,
    status: 'sending',
    repliesCount: 0,
    deleted: false,
    ...content,
  };
}

async function insert(
  messageId: string,
  outgoing: Outgoing,
  uploaded: UploadedMedia[],
): Promise<Comment> {
  if (outgoing.type === 'voice') {
    const [file] = uploaded;

    return sendVoiceComment(
      messageId,
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

  if (outgoing.type !== 'post') throw new Error('Комментарий не пересылается');

  return sendComment(messageId, {
    text: outgoing.text || undefined,
    media: uploaded.map(toSendMedia),
    replyTo: outgoing.replyTo,
  });
}

/**
 * Подтверждённое переезжает в кеш — в том же проходе, в котором уходит из
 * исходящих. Верхнеуровневое закрепляется наверху до закрытия панели, ответ
 * встаёт в конец треда: тред создаётся, даже если его ещё не открывали, —
 * своё начало он дочитает, а ответ уже лежит за разрывом.
 */
function settle(queryClient: QueryClient, messageId: string, localId: string, saved: Comment) {
  const localPreviews = outboxComments(messageId).find((item) => item.localId === localId)
    ?.localPreviews;
  const item: CommentItem = { ...toCommentItem(saved), localPreviews };

  if (saved.threadRootId) {
    updateThread(queryClient, messageId, saved.threadRootId, (page) => addToThread(page, item), {
      create: true,
    });
    // Число ответов у корня — сразу; точное догонит сигнал канала.
    updateRoots(queryClient, messageId, (page) => ({
      ...page,
      pinned: page.pinned.map((root) => bumpReplies(root, saved.threadRootId!)),
      items: page.items.map((root) => bumpReplies(root, saved.threadRootId!)),
    }));
  } else {
    updateRoots(queryClient, messageId, (page) => pinRoot(page, item));
  }

  notifyManager.schedule(() => removeOutboxComment(messageId, localId));
}

function bumpReplies(root: CommentItem, rootId: string): CommentItem {
  return root.id === rootId ? { ...root, repliesCount: root.repliesCount + 1 } : root;
}

/** Отказ, который повтор не исправит, — сказать человеку по-человечески. */
function explainRejection(cause: unknown) {
  if (errorCode(cause) === 'P0002') {
    showNotice('Не отправлено: сообщение удалено', 'error');
  }
}

export async function deliverComment(
  context: CommentSendContext,
  localId: string,
  outgoing: Outgoing,
): Promise<void> {
  const { queryClient, messageId, currentUserId } = context;

  if (delivering.has(localId)) return;

  delivering.add(localId);
  setOutboxCommentStatus(messageId, localId, 'sending');
  // Кружок у облачка — сразу, во всех местах, где сообщение показано: в его
  // чате и в островках других. Не дошло — число возвращается.
  updateAllHistories(queryClient, (history) => bumpCommentsCount(history, messageId, 1));

  let uploaded: UploadedMedia[] = [];
  let saved: Comment | null = null;

  try {
    const hasFiles =
      outgoing.type === 'voice' || (outgoing.type === 'post' && outgoing.media.length > 0);

    // Путь в Storage строится от своего id — без него файлы залить некуда.
    if (hasFiles && !currentUserId) throw new Error('Нет активной сессии');

    uploaded = hasFiles ? await uploadOutgoing(outgoing, currentUserId!) : [];

    if (discarded.has(localId)) throw new Error('Отправка отменена');

    saved = await insert(messageId, outgoing, uploaded);

    // Уже в базе, но человек его удалил — удаляем и там, для всех.
    if (discarded.has(localId)) {
      void deleteComment(saved.id).catch(() => undefined);
      return;
    }

    settle(queryClient, messageId, localId, saved);
  } catch (cause) {
    // Комментарий в базу не попал — загруженные файлы ничьи.
    if (!saved && uploaded.length > 0) {
      void Promise.all(uploaded.map((item) => removeUploadedMedia(storedPaths(item))));
    }

    if (!saved) updateAllHistories(queryClient, (history) => bumpCommentsCount(history, messageId, -1));

    if (discarded.has(localId)) return;

    if (isNetworkError(cause)) reportRequestFailed();
    else explainRejection(cause);

    // Право писать решает база; отказ — это «Не отправлено», а не тихая пропажа.
    setOutboxCommentStatus(messageId, localId, 'failed');
  } finally {
    delivering.delete(localId);
    discarded.delete(localId);
  }
}

/**
 * Тред ответа: корень и его цитата, если корень жив. Цитата корня нужна
 * частям длинного альбома — без цитаты часть ушла бы наверх, а не в тред.
 */
export type CommentThreadTarget = { rootId: string; rootQuote: LiveQuote | null };

/**
 * Текст с альбомом. Больше одного альбома — несколько комментариев, подпись
 * и цитаты ответа — у первого. Остальные части ответа остаются в том же
 * треде: их цитата — корень, а облачко такую цитату не показывает.
 */
export function sendCommentPost(
  context: CommentSendContext,
  text: string,
  media: MediaLibraryItem[] = [],
  replies: LiveQuote[] = [],
  thread: CommentThreadTarget | null = null,
) {
  const trimmed = text.trim();

  if (!trimmed && media.length === 0) return;

  const now = Date.now();
  const threadRootId = replies.length > 0 ? (thread?.rootId ?? null) : null;
  const rootQuote = threadRootId ? (thread?.rootQuote ?? null) : null;
  const drafts = splitIntoAlbums(trimmed, media).map((part, index) => {
    const attachments = part.media.map(toLocalAttachment);
    const partReplies = index === 0 ? replies : rootQuote ? [rootQuote] : [];

    return draftOf(context, now + index, {
      kind: part.media.length > 0 ? 'media' : 'text',
      text: part.text || null,
      attachments,
      pendingMedia: part.media.length > 0 ? part.media : undefined,
      localPreviews: part.media.length > 0 ? attachments.map((item) => item.url) : undefined,
      replies: partReplies,
      threadRootId: partReplies.length > 0 ? threadRootId : null,
    });
  });

  addOutboxComments(context.messageId, [...drafts].reverse());

  // По очереди: параллельная вставка перемешала бы их время на сервере.
  void (async () => {
    for (const draft of drafts) {
      const outgoing = outgoingOf(draft);

      if (outgoing) await deliverComment(context, draft.localId!, outgoing);
    }
  })();
}

/** Голосовое; с цитатами — ответ в тред их корня `threadRootId`. */
export function sendCommentVoice(
  context: CommentSendContext,
  voice: LocalMedia,
  replies: LiveQuote[] = [],
  threadRootId: string | null = null,
) {
  const draft = draftOf(context, Date.now(), {
    kind: 'voice',
    text: null,
    attachments: [],
    pendingVoice: voice,
    // Своё голосовое играет из файла на телефоне и после отправки.
    localPreviews: [voice.uri],
    replies,
    threadRootId: replies.length > 0 ? threadRootId : null,
  });

  draft.attachments = [toLocalVoiceAttachment(draft.localId!, voice)];
  addOutboxComments(context.messageId, [draft]);
  void deliverComment(context, draft.localId!, {
    type: 'voice',
    voice,
    replyTo: replies.map((quote) => quote.messageId),
  });
}

/** «Повторить» у упавшего. */
export function retryComment(context: CommentSendContext, localId: string) {
  const failed = outboxComments(context.messageId).find((item) => item.localId === localId);
  const outgoing = failed ? outgoingOf(failed) : null;

  if (outgoing) void deliverComment(context, localId, outgoing);
}

/** Своё неотправленное — убрать. Если оно как раз едет, по прибытии его не покажут. */
export function discardComment(messageId: string, localId: string) {
  if (delivering.has(localId)) discarded.add(localId);

  removeOutboxComment(messageId, localId);
}
