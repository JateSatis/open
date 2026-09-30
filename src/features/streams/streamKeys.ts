// Ключи запросов звонков — отдельно от хуков, чтобы чужие фичи (канал чата,
// личный канал) могли будить кеш, не подтягивая за собой запросы и LiveKit.

export function liveStreamQueryKey(chatId: string) {
  return ['streams', 'live', chatId] as const;
}
