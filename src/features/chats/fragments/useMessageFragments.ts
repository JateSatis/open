import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { listMessageFragments, type Fragment, type FragmentRange } from '@/api/fragments';
import { acquireCommentTopic } from '@/api/commentTopics';
import { clustersKeyOf } from '@/features/chats/fragments/clusterKeys';

/** Фрагменты сообщения в кеше — по id сообщения. */
export function fragmentsKey(messageId: string) {
  return ['fragments', messageId] as const;
}

/** Мой видимый фрагмент на этом диапазоне (code points) — тот, что продолжает выделение. */
export function myFragmentOn(
  fragments: readonly Fragment[] | undefined,
  me: string | null,
  range: Pick<FragmentRange, 'start' | 'end'>,
): Fragment | null {
  if (!fragments || !me) return null;

  return (
    fragments.find(
      (fragment) =>
        fragment.authorId === me &&
        !fragment.lost &&
        fragment.start === range.start &&
        fragment.end === range.end,
    ) ?? null
  );
}

export function readMessageFragments(
  queryClient: QueryClient,
  messageId: string,
): Fragment[] | undefined {
  return queryClient.getQueryData<Fragment[]>(fragmentsKey(messageId));
}

export function setMessageFragments(
  queryClient: QueryClient,
  messageId: string,
  update: (fragments: Fragment[]) => Fragment[],
) {
  queryClient.setQueryData<Fragment[]>(fragmentsKey(messageId), (current) =>
    update(current ?? []),
  );
}

/**
 * Фрагменты сообщения со счётчиками и моей реакцией. `live` — пока на виду
 * панель фрагмента: реакции других приходят сигналом в топик комментариев
 * сообщения и перечитываются.
 */
export function useMessageFragments(messageId: string | null, live = false) {
  const api = useRequestClient();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: fragmentsKey(messageId ?? ''),
    queryFn: () => listMessageFragments(messageId!, api),
    enabled: messageId !== null,
    // Меню встаёт заново после каждого отпускания ручки — список не
    // перечитывается каждый раз: свежесть держат сигналы и свои реакции.
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!live || !messageId) return;

    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: fragmentsKey(messageId) });
      void queryClient.invalidateQueries({ queryKey: clustersKeyOf(messageId) });
    };

    return acquireCommentTopic(messageId, {
      onFragmentReactionsChanged: refresh,
      onAdded: refresh,
      onDeleted: refresh,
      onReconnected: refresh,
    }, api);
  }, [api, live, messageId, queryClient]);

  return query;
}
