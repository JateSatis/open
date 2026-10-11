import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import { listMessagesByIds } from '@/api/chats';
import { acquireCommentTopic } from '@/api/commentTopics';
import { replaceMessages, updateHistory } from '@/features/chats/messages/historyCache';
import type { ChatMessage } from '@/features/chats/messages/types';

/** Столько копить сигналы, прежде чем перечитать: на горячий комментарий реакции сыплются пачками. */
const BATCH_MS = 500;

/** Ветки (сообщения и попсы под комментариями), из которых здесь лежат пересланные комментарии. */
function sourceThreads(messages: ChatMessage[]): string {
  const ids = new Set<string>();

  for (const message of messages) {
    const comment = message.commentForward?.comment;

    if (comment) ids.add(comment.subject.id);
  }

  return [...ids].sort().join(',');
}

/**
 * Пересланный комментарий — ссылка на оригинал: правка, удаление и реакции
 * оригинала приходят в топик его ветки (`comments:<target_id>` — сообщения или
 * попа), а не в топик этого чата. Удаление попа приходит туда же
 * (`target_changed`): цитата становится «Поп удалён». Экран слушает ветки загруженных пересланных комментариев
 * и перечитывает облачка, которые на них ссылаются. Каналы общие
 * (`commentTopics`): открытая панель той же ветки им не мешает.
 */
export function useForwardedCommentSources(chatId: string, messages: ChatMessage[]) {
  const queryClient = useQueryClient();
  const threads = useMemo(() => sourceThreads(messages), [messages]);
  const latest = useRef(messages);

  useEffect(() => {
    latest.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!threads) return;

    const changed = new Set<string>();
    const changedTargets = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      const commentIds = new Set(changed);
      const targetIds = new Set(changedTargets);

      changed.clear();
      changedTargets.clear();
      timer = null;

      const forwards = latest.current
        .filter((message) => {
          const comment = message.commentForward?.comment;

          return (
            comment !== undefined &&
            comment !== null &&
            (commentIds.has(comment.id) || targetIds.has(comment.subject.id)) &&
            message.status === 'sent'
          );
        })
        .map((message) => message.id);

      if (forwards.length === 0) return;

      // Не вышло — догонит следующий сигнал или перечитывание истории.
      listMessagesByIds(forwards)
        .then((fresh) => updateHistory(queryClient, chatId, (current) => replaceMessages(current, fresh)))
        .catch(() => undefined);
    };

    const schedule = () => {
      if (!timer) timer = setTimeout(flush, BATCH_MS);
    };

    const onChange = (commentId: string) => {
      changed.add(commentId);
      schedule();
    };

    const releases = threads.split(',').map((targetId) =>
      acquireCommentTopic(targetId, {
        onEdited: onChange,
        onDeleted: onChange,
        onReactionsChanged: onChange,
        onTargetChanged: () => {
          changedTargets.add(targetId);
          schedule();
        },
      }),
    );

    return () => {
      releases.forEach((release) => release());

      if (timer) clearTimeout(timer);
    };
  }, [chatId, queryClient, threads]);
}
