// Отправка своей реакции. Вне компонентов — как и отправка сообщений: закрыл
// чат, а реакция всё равно доезжает.
//
// На одно сообщение в полёте не больше одного запроса. Быстрые тапы только
// меняют желаемое в наложении, а очередь, дождавшись ответа, отправляет
// последнее желаемое: запросы не обгоняют друг друга по дороге, и в базе
// остаётся то, что человек выбрал последним.

import { requestClient } from '@/api/requestClient';

import type { QueryClient } from '@tanstack/react-query';

import { setCommentReaction } from '@/api/comments';
import { setMessageReaction, setPopReaction, type MyReaction } from '@/api/reactions';
import { mapOriginals } from '@/features/chats/islands/islandCache';
import { updateAllHistories } from '@/features/chats/messages/historyCache';
import {
  clearPendingReaction,
  reactionQueues,
  setPendingReaction,
} from '@/features/interactions/pendingReactions';
import { updateCommentEverywhere } from '@/features/interactions/comments/commentsCache';
import { replaceMine, type Me, type ReactionIntent } from '@/features/interactions/reactionState';
import { showNotice } from '@/features/notifications/alertsStore';
import { replacePopMine } from '@/features/pops/popReactions';
import { updatePopEverywhere } from '@/features/pops/popsCache';
import { isNetworkError } from '@/lib/network';

/**
 * Подтверждённое базой — в кеш истории, везде, где сообщение показано: в
 * своём чате и в островках других. Ряд берётся из ответа: он мог разойтись с
 * догадкой клиента, например, заявку приняли, пока экран этого не знал. Чужие
 * реакции, пришедшие тем временем, догонит событие канала.
 */
function confirmMessage(
  queryClient: QueryClient,
  messageId: string,
  mine: MyReaction | null,
  me?: Me,
) {
  updateAllHistories(queryClient, (history) => {
    let changed = false;

    const items = history.items.map((message) => {
      const own =
        message.id === messageId
          ? { ...message, reactions: replaceMine(message.reactions, mine, me) }
          : message;
      const next = mapOriginals(own, (original) =>
        original.id === messageId
          ? { ...original, reactions: replaceMine(original.reactions, mine, me) }
          : original,
      );

      if (next !== message) changed = true;

      return next;
    });

    return changed ? { ...history, items } : history;
  });
}

/**
 * Подтверждённая реакция на комментарий — во все загруженные ветки, где он
 * есть, и в пересланные копии в чатах: там облачко показывает реакции
 * оригинала.
 */
function confirmComment(
  queryClient: QueryClient,
  commentId: string,
  mine: MyReaction | null,
  me?: Me,
) {
  updateCommentEverywhere(queryClient, (item) =>
    item.id === commentId
      ? { ...item, reactions: replaceMine(item.reactions, mine, me, true) }
      : item,
  );
  updateAllHistories(queryClient, (history) => {
    let changed = false;

    const items = history.items.map((message) => {
      const forwarded = message.commentForward?.comment;

      if (forwarded?.id !== commentId) return message;

      changed = true;
      return {
        ...message,
        commentForward: {
          ...message.commentForward!,
          comment: { ...forwarded, reactions: replaceMine(forwarded.reactions, mine, me, true) },
        },
      };
    });

    return changed ? { ...history, items } : history;
  });
}

/** Подтверждённая реакция на поп — во все загруженные списки попсов: сетку и просмотр. */
function confirmPop(queryClient: QueryClient, popId: string, mine: MyReaction | null) {
  updatePopEverywhere(queryClient, popId, (pop) => {
    const reactions = replacePopMine(pop.reactions, mine?.emoji ?? null);

    return reactions === pop.reactions ? pop : { ...pop, reactions };
  });
}

/** Куда ставится реакция. У всех целей одна очередь и одно наложение. */
export type ReactionTarget = 'message' | 'comment' | 'pop';

const TARGETS: Record<
  ReactionTarget,
  {
    send: typeof setMessageReaction;
    confirm: (queryClient: QueryClient, id: string, mine: MyReaction | null, me?: Me) => void;
  }
> = {
  message: { send: setMessageReaction, confirm: confirmMessage },
  comment: { send: setCommentReaction, confirm: confirmComment },
  pop: { send: setPopReaction, confirm: confirmPop },
};

/**
 * База отвергла новую разную реакцию: ряд уже полон (`reaction_kinds_limit`).
 * Меню такую не предлагает, но набор мог заполниться, пока оно было открыто.
 */
function isReactionLimit(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'OR001';
}



async function drain(queryClient: QueryClient, messageId: string, target: ReactionTarget, api: ReturnType<typeof requestClient>) {
  const { send, confirm } = TARGETS[target];

  const queue = reactionQueues(api);

  try {
    for (;;) {
      const wanted = queue.get(messageId);

      if (!wanted) return;

      const mine = await send(messageId, wanted.emoji, api);

      if (queue !== reactionQueues(api)) return;
      confirm(queryClient, messageId, mine, wanted.me);

      // Пока ехал запрос, человек передумал — отправляем новое желаемое.
      if (queue.get(messageId) !== wanted) continue;

      if (api === requestClient()) clearPendingReaction(messageId, wanted);
      return;
    }
  } catch (cause) {
    // Откат — снятие наложения: облачко возвращается к тому, что знает база.
    if (api !== requestClient() || queue !== reactionQueues(api)) return;
    clearPendingReaction(messageId);
    showNotice(
      isNetworkError(cause)
        ? 'Не удалось поставить реакцию: нет связи'
        : isReactionLimit(cause)
          ? 'Разных реакций уже слишком много — выберите из поставленных'
          : 'Не удалось поставить реакцию',
      'error',
    );
  } finally {
    queue.delete(messageId);
  }
}

/**
 * Ставит, меняет или снимает мою реакцию на сообщение, комментарий или поп.
 * На экране — сразу, наложением, везде, где цель показана; в базу — очередью
 * (см. выше). Ключ наложения — id цели: uuid разных целей не пересекаются.
 */
export function sendReaction(
  queryClient: QueryClient,
  id: string,
  intent: ReactionIntent,
  target: ReactionTarget = 'message',
  api = requestClient(),
) {
  // У комментария поставившие — из обоих рядов, у сообщения — только участники.
  const queue = reactionQueues(api);
  const running = queue.has(id);
  const wanted = { ...intent, listsVisitors: target === 'comment' };
  queue.set(id, wanted);
  if (api === requestClient()) setPendingReaction(id, wanted);

  if (!running) void drain(queryClient, id, target, api);
}
