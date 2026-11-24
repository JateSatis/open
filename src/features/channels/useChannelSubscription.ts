import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useQuery } from '@tanstack/react-query';

import { getMySubscription, type ChannelSubscription } from '@/api/subscriptions';
import { channelSubscriptionQueryKey } from '@/features/channels/keys';
import { useCanPublishState } from '@/features/pops/queries';
import { useHistoryReader } from '@/features/chats/messages/local/reader';
import { routeOptions } from '@/features/chats/messages/local/route';

/**
 * Кто я каналу. `unknown` — ответа ещё нет: кнопка подписки не мигает ни
 * публикующему, ни подписанному. `publisher` — публикую в нём, подписка мне не нужна.
 */
export type SubscriptionStatus = 'unknown' | 'publisher' | 'none' | 'subscriber' | 'reader';

export type ChannelSubscriptionState = {
  status: SubscriptionStatus;
  subscription: ChannelSubscription | null;
};

export function statusOf(
  canPublish: boolean | undefined,
  subscription: ChannelSubscription | null | undefined,
): SubscriptionStatus {
  if (canPublish === undefined) return 'unknown';
  if (canPublish) return 'publisher';
  if (subscription === undefined) return 'unknown';
  if (subscription === null) return 'none';

  return subscription.inChats ? 'reader' : 'subscriber';
}

export function useChannelSubscription(channelId: string): ChannelSubscriptionState {
  const api = useRequestClient();
  const reader = useHistoryReader();
  const { canPublish, known } = useCanPublishState(channelId);
  const { data } = useQuery({
    queryKey: channelSubscriptionQueryKey(channelId),
    ...routeOptions(reader, 'subscription/' + channelId, () => getMySubscription(channelId, api)),
    enabled: known && !canPublish,
  });

  return {
    status: statusOf(known ? canPublish : undefined, data),
    subscription: data ?? null,
  };
}
