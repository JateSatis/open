// Отправка своих комментариев: облачко сразу, со статусом доставки —
// верхнеуровневое наверху списка, ответ в конце своего треда; загрузка
// файлов, вызов функции базы, перенос подтверждённого в кеш. Живёт вне
// компонентов — закрытая панель отправку не обрывает.
//
// Собрано из тех же частей, что и отправка сообщений: локальные превью,
// разбиение альбома, загрузка в Storage, повтор. Своё здесь только то, куда
// комментарий уходит и куда ложится.

import { notifyManager, type QueryClient } from '@tanstack/react-query';

import {
  deleteComment,
  sendComment,
  sendPopComment,
  sendVoiceComment,
  sendVoicePopComment,
  type Comment,
  type CommentSubject,
} from '@/api/comments';
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
  raiseRoot,
  updateRoots,
  updateThread,
} from '@/features/interactions/comments/commentsCache';
import {
  removeUploadedMedia,
  storedPaths,
  type LocalMedia,
  type OutgoingMedia,
  type UploadedMedia,
} from '@/features/media';
import { showNotice } from '@/features/notifications/alertsStore';
import { bumpPopComments } from '@/features/pops/popsCache';
import { isNetworkError } from '@/lib/network';

export type CommentSendContext = {
  queryClient: QueryClient;
  subject: CommentSubject;
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
  { subject, chatId, currentUserId, me }: CommentSendContext,
  at: number,
  content: Pick<CommentItem, 'kind' | 'text' | 'attachments' | 'threadRootId'> &
    Partial<Pick<CommentItem, 'pendingMedia' | 'pendingVoice' | 'localPreviews' | 'replies'>>,
): CommentItem {
  const localId = nextLocalId();

  return {
    id: localId,
    localId,
    chatId,
    targetId: subject.id,
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
    viewsCount: 0,
    readAt: null,
    status: 'sending',
    repliesCount: 0,
    deleted: false,
    ...content,
  };
}

async function insert(
  subject: CommentSubject,
  outgoing: Outgoing,
  uploaded: UploadedMedia[],
  threadRootId: string | null,
): Promise<Comment> {
  if (outgoing.type === 'voice') {
    const [file] = uploaded;

    return (subject.type === 'pop' ? sendVoicePopComment : sendVoiceComment)(
      subject.id,
      {
        url: file.url,
        mimeType: file.mimeType,
        durationMs: file.durationMs ?? 0,
        sizeBytes: file.sizeBytes,
        waveform: file.waveform,
      },
      outgoing.replyTo,
      threadRootId,
    );
  }

  if (outgoing.type !== 'post') throw new Error('Комментарий не пересылается');

  return (subject.type === 'pop' ? sendPopComment : sendComment)(subject.id, {
    text: outgoing.text || undefined,
    media: uploaded.map(toSendMedia),
    replyTo: outgoing.replyTo,
    threadRootId,
  });
}

/**
 * Подтверждённое переезжает в кеш — в том же проходе, в котором уходит из
 * исходящих. Верхнеуровневое закрепляется наверху до закрытия панели, ответ
 * встаёт в конец треда: тред создаётся, даже если его ещё не открывали, —
 * своё начало он дочитает, а ответ уже лежит за разрывом.
 */
function settle(queryClient: QueryClient, targetId: string, localId: string, saved: Comment) {
  const localPreviews = outboxComments(targetId).find((item) => item.localId === localId)
    ?.localPreviews;
  const item: CommentItem = { ...toCommentItem(saved), localPreviews };

  if (saved.threadRootId) {
    updateThread(queryClient, targetId, saved.threadRootId, (page) => addToThread(page, item), {
      create: true,
    });
    // Число ответов у корня — сразу; точное догонит сигнал канала.
    updateRoots(queryClient, targetId, (page) => ({
      ...page,
      authorPin: page.authorPin && bumpReplies(page.authorPin, saved.threadRootId!),
      raised: page.raised.map((root) => bumpReplies(root, saved.threadRootId!)),
      items: page.items.map((root) => bumpReplies(root, saved.threadRootId!)),
    }));
  } else {
    updateRoots(queryClient, targetId, (page) => raiseRoot(page, item));
  }

  notifyManager.schedule(() => removeOutboxComment(targetId, localId));
}

function bumpReplies(root: CommentItem, rootId: string): CommentItem {
  return root.id === rootId ? { ...root, repliesCount: root.repliesCount + 1 } : root;
}

/** Число комментариев цели — у попа на кнопке просмотра, у сообщения в кружке у облачка. */
function bumpCount(queryClient: QueryClient, subject: CommentSubject, delta: number) {
  if (subject.type === 'pop') bumpPopComments(queryClient, subject.id, delta);
  else updateAllHistories(queryClient, (history) => bumpCommentsCount(history, subject.id, delta));
}

/** Отказ, который повтор не исправит, — сказать человеку по-человечески. */
function explainRejection(cause: unknown, subject: CommentSubject) {
  if (errorCode(cause) === 'P0002') {
    showNotice(
      subject.type === 'pop' ? 'Не отправлено: поп удалён' : 'Не отправлено: сообщение удалено',
      'error',
    );
  }
}

export async function deliverComment(
  context: CommentSendContext,
  localId: string,
  outgoing: Outgoing,
  threadRootId: string | null,
): Promise<void> {
  const { queryClient, subject, currentUserId } = context;
  const targetId = subject.id;

  if (delivering.has(localId)) return;

  delivering.add(localId);
  setOutboxCommentStatus(targetId, localId, 'sending');
  // Кружок у облачка — сразу, во всех местах, где сообщение показано: в его
  // чате и в островках других. Не дошло — число возвращается.
  bumpCount(queryClient, subject, 1);

  let uploaded: UploadedMedia[] = [];
  let saved: Comment | null = null;

  try {
    const hasFiles =
      outgoing.type === 'voice' || (outgoing.type === 'post' && outgoing.media.length > 0);

    // Путь в Storage строится от своего id — без него файлы залить некуда.
    if (hasFiles && !currentUserId) throw new Error('Нет активной сессии');

    uploaded = hasFiles ? await uploadOutgoing(outgoing, currentUserId!) : [];

    if (discarded.has(localId)) throw new Error('Отправка отменена');

    saved = await insert(subject, outgoing, uploaded, threadRootId);

    // Уже в базе, но человек его удалил — удаляем и там, для всех.
    if (discarded.has(localId)) {
      void deleteComment(saved.id).catch(() => undefined);
      bumpCount(queryClient, subject, -1);
      return;
    }

    settle(queryClient, targetId, localId, saved);
  } catch (cause) {
    // Комментарий в базу не попал — загруженные файлы ничьи.
    if (!saved && uploaded.length > 0) {
      void Promise.all(uploaded.map((item) => removeUploadedMedia(storedPaths(item))));
    }

    if (!saved) bumpCount(queryClient, subject, -1);

    if (discarded.has(localId)) return;

    if (isNetworkError(cause)) reportRequestFailed();
    else explainRejection(cause, subject);

    // Право писать решает база; отказ — это «Не отправлено», а не тихая пропажа.
    setOutboxCommentStatus(targetId, localId, 'failed');
  } finally {
    delivering.delete(localId);
    discarded.delete(localId);
  }
}

/**
 * Текст с альбомом. Больше одного альбома — несколько комментариев, подпись
 * и цитаты ответа — у первого. Тред база получает явно (`threadRootId`), и
 * все части ответа ложатся в него, с цитатами или без.
 */
export function sendCommentPost(
  context: CommentSendContext,
  text: string,
  media: OutgoingMedia[] = [],
  replies: LiveQuote[] = [],
  threadRootId: string | null = null,
) {
  const trimmed = text.trim();

  if (!trimmed && media.length === 0) return;

  const now = Date.now();
  const drafts = splitIntoAlbums(trimmed, media).map((part, index) => {
    const attachments = part.media.map(toLocalAttachment);

    return draftOf(context, now + index, {
      kind: part.media.length > 0 ? 'media' : 'text',
      text: part.text || null,
      attachments,
      pendingMedia: part.media.length > 0 ? part.media : undefined,
      localPreviews: part.media.length > 0 ? attachments.map((item) => item.url) : undefined,
      replies: index === 0 ? replies : [],
      threadRootId,
    });
  });

  addOutboxComments(context.subject.id, [...drafts].reverse());

  // По очереди: параллельная вставка перемешала бы их время на сервере.
  void (async () => {
    for (const draft of drafts) {
      const outgoing = outgoingOf(draft);

      if (outgoing) await deliverComment(context, draft.localId!, outgoing, threadRootId);
    }
  })();
}

/** Голосовое; в треде `threadRootId` — ответ в него, с цитатами или без. */
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
    threadRootId,
  });

  draft.attachments = [toLocalVoiceAttachment(draft.localId!, voice)];
  addOutboxComments(context.subject.id, [draft]);
  void deliverComment(
    context,
    draft.localId!,
    { type: 'voice', voice, replyTo: replies.map((quote) => quote.messageId) },
    threadRootId,
  );
}

/** «Повторить» у упавшего. */
export function retryComment(context: CommentSendContext, localId: string) {
  const failed = outboxComments(context.subject.id).find((item) => item.localId === localId);
  const outgoing = failed ? outgoingOf(failed) : null;

  if (failed && outgoing) void deliverComment(context, localId, outgoing, failed.threadRootId);
}

/** Своё неотправленное — убрать. Если оно как раз едет, по прибытии его не покажут. */
export function discardComment(targetId: string, localId: string) {
  if (delivering.has(localId)) discarded.add(localId);

  removeOutboxComment(targetId, localId);
}
