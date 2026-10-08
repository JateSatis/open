// Ключи кеша попсов — отдельно от запросов: их берут и модули, которым сам
// клиент базы не нужен (доставка сообщений чата).

export const popsQueryKey = (channelId: string) => ['pops', channelId] as const;
