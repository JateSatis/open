// Отправка своих комментариев: пузырь внизу панели сразу, со статусом
// доставки; загрузка файлов, вызов функции базы, перенос подтверждённого в
// кеш. Живёт вне компонентов — закрытая панель отправку не обрывает.
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
import type { Outgoing } from '@/features/chats/messages/types';
import { reportRequestFailed } from '@/features/connection/connectionStore';
import {
  addOutboxComments,
  outboxComments,
  removeOutboxComment,
  setOutboxCommentStatus,
} from '@/features/interactions/comments/commentOutbox';
import type { CommentItem } from '@/features/interactions/comments/commentItem';
import { toCommentItem } from '@/features/interactions/comments/commentItem';
import { mergeComments, updateComments } from '@/features/interactions/comments/commentsCache';
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
  content: Pick<CommentItem, 'kind' | 'text' | 'attachments'> &
    Partial<Pick<CommentItem, 'pendingMedia' | 'pendingVoice' | 'localPreviews'>>,
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

    return sendVoiceComment(messageId, {
      url: file.url,
      mimeType: file.mimeType,
      durationMs: file.durationMs ?? 0,
      sizeBytes: file.sizeBytes,
      waveform: file.waveform,
    });
  }

  if (outgoing.type !== 'post') throw new Error('Комментарий не пересылается');

  return sendComment(messageId, {
    text: outgoing.text || undefined,
    media: uploaded.map(toSendMedia),
  });
}

/** Подтверждённое переезжает в кеш — в том же проходе, в котором уходит из исходящих. */
function settle(queryClient: QueryClient, messageId: string, localId: string, saved: Comment) {
  const localPreviews = outboxComments(messageId).find((item) => item.localId === localId)
    ?.localPreviews;

  updateComments(queryClient, messageId, (page) => {
    const merged = mergeComments(page, [saved]);

    return {
      ...merged,
      items: merged.items.map((item) =>
        item.id === saved.id ? { ...toCommentItem(saved), localPreviews } : item,
      ),
    };
  });

  notifyManager.schedule(() => removeOutboxComment(messageId, localId));
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

/** Текст с альбомом. Больше одного альбома — несколько комментариев, подпись у первого. */
export function sendCommentPost(
  context: CommentSendContext,
  text: string,
  media: MediaLibraryItem[] = [],
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

export function sendCommentVoice(context: CommentSendContext, voice: LocalMedia) {
  const draft = draftOf(context, Date.now(), {
    kind: 'voice',
    text: null,
    attachments: [],
    pendingVoice: voice,
    // Своё голосовое играет из файла на телефоне и после отправки.
    localPreviews: [voice.uri],
  });

  draft.attachments = [toLocalVoiceAttachment(draft.localId!, voice)];
  addOutboxComments(context.messageId, [draft]);
  void deliverComment(context, draft.localId!, { type: 'voice', voice, replyTo: [] });
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
