import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { getMySubscription, markChannelRead, type ChannelSubscription } from '@/api/subscriptions';
import { channelSubscriptionQueryKey } from '@/features/channels/keys';
import { chatsQueryKey } from '@/features/chats/chatsKey';

export type ChannelSection = 'posts' | 'pops';

/**
 * Пока раздел канала открыт, его содержимое прочитано подписчиком. Отметка
 * ставится при входе и на каждое новое — `newestId` и есть сигнал «пришло
 * новое», как у `useMarkChatRead`. Счётчик раздела гаснет сразу, не дожидаясь
 * базы. Не подписан (посторонний, публикующий) — отметок нет.
 */
export function useMarkChannelSectionRead(
  channelId: string | null,
  section: ChannelSection,
  newestId: string | null,
  active: boolean,
) {
  const queryClient = useQueryClient();
  // Только читает кеш: запрашивает подписку тот, кто рисует кнопку (`useChannelSubscription`).
  const { data: subscription } = useQuery({
    queryKey: channelSubscriptionQueryKey(channelId ?? ''),
    queryFn: () => getMySubscription(channelId!),
    enabled: false,
  });
  const subscribed = Boolean(subscription);

  useEffect(() => {
    if (!channelId || !active || !subscribed) return;

    const field = section === 'posts' ? 'unreadPosts' : 'unreadPops';

    queryClient.setQueryData<ChannelSubscription | null>(
      channelSubscriptionQueryKey(channelId),
      (current) => (current && current[field] > 0 ? { ...current, [field]: 0 } : current),
    );

    let alive = true;

    markChannelRead(channelId, { posts: section === 'posts', pops: section === 'pops' })
      .then(() => {
        if (!alive) return;

        // Перечитывание, ушедшее в базу раньше отметки (новый пост пришёл
        // посреди неё), вернуло бы на вкладку старое число — перечитываем после.
        void queryClient.invalidateQueries({ queryKey: channelSubscriptionQueryKey(channelId) });
        void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
      })
      .catch(() => {
        // Как и у отметки участника: следующий вход или новое поправят.
      });

    return () => {
      alive = false;
    };
  }, [active, channelId, newestId, queryClient, section, subscribed]);
}
