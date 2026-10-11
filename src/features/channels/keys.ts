/** Ключ запроса канала — отдельно от хука, чтобы читать кеш без клиента базы. */
export const channelQueryKey = (channelId: string) => ['channel', channelId] as const;
