/** Ключ запроса канала — отдельно от хука, чтобы читать кеш без клиента базы. */
export const channelQueryKey = (channelId: string) => ['channel', channelId] as const;

/** Моя подписка на канал — один кеш на экран канала, просмотр попсов и список. */
export const channelSubscriptionQueryKey = (channelId: string) =>
  ['channel', channelId, 'subscription'] as const;
