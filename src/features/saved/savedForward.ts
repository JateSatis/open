// «Переслать» в «Сохранённых»: в чат уходит не копия, а живой оригинал —
// островком из чата источника или ссылкой на комментарий. Что из выбранного
// ещё живо и откуда, решает база (`saved_forwardable`); удалённое
// пропускается, а целиком удалённое лист не открывает.

import type { useRouter } from 'expo-router';

import type { ChatRef, ForwardedComment, IslandOriginal } from '@/api/chats';
import { listForwardedComments, listIslandOriginals } from '@/api/messageRows';
import { listSavedForwardable, type SavedMessage } from '@/api/saved';
import {
  batchSize,
  startForwardPick,
  type ForwardBatch,
} from '@/features/chats/composerDraftStore';
import { showNotice } from '@/features/notifications/alertsStore';

type Group =
  | { type: 'chat'; chat: ChatRef; originals: IslandOriginal[] }
  | { type: 'comments'; comments: ForwardedComment[] };

/**
 * Пачки пересылки по порядку на экране: по островку на чат-источник (там,
 * где встретилась первая запись из него) и комментарии одной пачкой.
 */
export function savedForwardBatches(
  items: readonly SavedMessage[],
  live: ReadonlyMap<string, { messageId: string | null; commentId: string | null }>,
  originals: ReadonlyMap<string, IslandOriginal>,
  comments: ReadonlyMap<string, ForwardedComment>,
): ForwardBatch[] {
  const groups: Group[] = [];
  const byChat = new Map<string, Extract<Group, { type: 'chat' }>>();
  let commentGroup: Extract<Group, { type: 'comments' }> | null = null;

  for (const saved of items) {
    const source = live.get(saved.id);
    const original = source?.messageId ? originals.get(source.messageId) : undefined;
    const comment = source?.commentId ? comments.get(source.commentId) : undefined;

    if (original?.chat) {
      let group = byChat.get(original.chat.id);

      if (!group) {
        group = {
          type: 'chat',
          chat: { id: original.chat.id, name: original.chat.name },
          originals: [],
        };
        byChat.set(original.chat.id, group);
        groups.push(group);
      }

      group.originals.push(original);
    } else if (comment) {
      if (!commentGroup) {
        commentGroup = { type: 'comments', comments: [] };
        groups.push(commentGroup);
      }

      commentGroup.comments.push(comment);
    }
  }

  return groups.map((group) =>
    group.type === 'chat'
      ? {
          sourceChat: group.chat,
          // Внутри островка — как в исходном чате, а не как сохраняли.
          items: [...group.originals]
            .sort((a, b) => a.seq - b.seq)
            .map((original) => ({ original })),
        }
      : { comments: group.comments },
  );
}

/**
 * Готовит пересылку выбранного (по порядку на экране) и открывает лист
 * «Кому переслать». Отвечает, открыт ли лист.
 */
export async function startSavedForward(
  router: ReturnType<typeof useRouter>,
  items: readonly SavedMessage[],
): Promise<boolean> {
  if (items.length === 0) return false;

  try {
    const forwardable = await listSavedForwardable(items.map((saved) => saved.id));
    const live = new Map(
      forwardable.flatMap((row) =>
        row.live
          ? [[row.savedId, { messageId: row.messageId, commentId: row.commentId }] as const]
          : [],
      ),
    );
    const messageIds = [...live.values()].flatMap((row) => (row.messageId ? [row.messageId] : []));
    const commentIds = [...live.values()].flatMap((row) => (row.commentId ? [row.commentId] : []));
    const [originals, comments] = await Promise.all([
      listIslandOriginals(messageIds),
      listForwardedComments(commentIds),
    ]);
    const batches = savedForwardBatches(
      items,
      live,
      new Map(originals.map((original) => [original.id, original])),
      new Map(comments.map((comment) => [comment.id, comment])),
    );
    const sent = batches.reduce((sum, batch) => sum + batchSize(batch), 0);

    if (sent === 0) {
      showNotice(
        items.length === 1
          ? 'Оригинал удалён — переслать нельзя'
          : 'Оригиналы удалены — переслать нельзя',
      );
      return false;
    }

    startForwardPick({ batches, skipped: items.length - sent });
    router.push('/chats/forward');
    return true;
  } catch {
    showNotice('Не удалось переслать', 'error');
    return false;
  }
}
