// Сводки плашек тредов чата в кеше запросов: корень → плашка (или `null` —
// ответов, видимых мне, нет). Одна запись на чат: корни приходят пачками со
// страницами «Тредов», сигналы Realtime перечитывают только свои корни.

import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import {
  listChatThreadSummaries,
  type ChatThreadPerson,
  type ChatThreadSummary,
} from '@/api/chats';
import type { MessagePreview } from '@/api/messagePreview';

export type ChatThreadSummaries = Record<string, ChatThreadSummary | null>;

const NO_SUMMARIES: ChatThreadSummaries = {};
/** Столько корней за раз — потолок функции в базе. */
const MAX_ROOTS = 200;

export function chatThreadSummariesKey(chatId: string) {
  return ['chat-thread-summaries', chatId] as const;
}

export function readChatThreadSummaries(
  queryClient: QueryClient,
  chatId: string,
): ChatThreadSummaries | undefined {
  return queryClient.getQueryData<ChatThreadSummaries>(chatThreadSummariesKey(chatId));
}

function merge(
  queryClient: QueryClient,
  chatId: string,
  rootIds: string[],
  fresh: ChatThreadSummary[],
) {
  const byRoot = new Map(fresh.map((summary) => [summary.rootId, summary]));

  queryClient.setQueryData<ChatThreadSummaries>(chatThreadSummariesKey(chatId), (current) => {
    const next = { ...(current ?? NO_SUMMARIES) };

    rootIds.forEach((id) => {
      next[id] = byRoot.get(id) ?? null;
    });

    return next;
  });
}

/** Перечитать плашки этих корней. Не вышло — перечитает следующий сигнал или вход в «Треды». */
export async function refreshChatThreadSummaries(
  queryClient: QueryClient,
  chatId: string,
  rootIds: string[],
): Promise<void> {
  const unique = [...new Set(rootIds)];

  for (let start = 0; start < unique.length; start += MAX_ROOTS) {
    const batch = unique.slice(start, start + MAX_ROOTS);

    merge(queryClient, chatId, batch, await listChatThreadSummaries(batch));
  }
}

/** Корни, у которых сейчас есть плашка, — после удаления ответа их числа могли измениться. */
export function knownChatThreadRoots(queryClient: QueryClient, chatId: string): string[] {
  const summaries = readChatThreadSummaries(queryClient, chatId) ?? NO_SUMMARIES;

  return Object.keys(summaries).filter((id) => summaries[id] !== null);
}

/**
 * Мой ответ ушёл в тред — плашка меняется сразу, не дожидаясь сервера: +1,
 * я последним ответившим, мой текст. Сервер потом пришлёт настоящую.
 */
export function bumpChatThreadSummaries(
  queryClient: QueryClient,
  chatId: string,
  rootIds: string[],
  me: ChatThreadPerson,
  preview: MessagePreview,
) {
  queryClient.setQueryData<ChatThreadSummaries>(chatThreadSummariesKey(chatId), (current) => {
    const next = { ...(current ?? NO_SUMMARIES) };

    rootIds.forEach((rootId) => {
      const known = next[rootId];
      const others = (known?.people ?? []).filter((person) => person.id !== me.id);
      const wasShown = (known?.people ?? []).some((person) => person.id === me.id);
      const total = (known?.people.length ?? 0) + (known?.othersCount ?? 0) + (wasShown ? 0 : 1);
      const people = [me, ...others].slice(0, 2);

      next[rootId] = {
        rootId,
        repliesCount: (known?.repliesCount ?? 0) + 1,
        last: { seq: known?.last?.seq ?? 0, createdAt: new Date().toISOString(), preview },
        people,
        othersCount: Math.max(total - people.length, 0),
      };
    });

    return next;
  });
}

/**
 * Плашки корней `rootIds` для экрана: незнакомые корни дочитываются пачкой.
 * Пока плашки нет — `undefined` у корня.
 */
export function useChatThreadSummaries(
  chatId: string,
  rootIds: string[],
  enabled: boolean,
): ChatThreadSummaries {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: chatThreadSummariesKey(chatId),
    // Наполняют запись дочитывание ниже и сигналы; сам запрос ничего не грузит.
    queryFn: () => readChatThreadSummaries(queryClient, chatId) ?? NO_SUMMARIES,
    staleTime: Infinity,
    enabled,
  });
  const summaries = data ?? NO_SUMMARIES;
  const missing = useMemo(
    () => (enabled ? rootIds.filter((id) => !(id in summaries)) : []),
    [enabled, rootIds, summaries],
  );
  const missingKey = missing.join(',');

  useEffect(() => {
    if (missing.length === 0) return;

    refreshChatThreadSummaries(queryClient, chatId, missing).catch(() => undefined);
    // Дочитывать по составу, а не по каждой новой ссылке на массив.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, missingKey, queryClient]);

  return summaries;
}
