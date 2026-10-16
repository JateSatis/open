// Ключи кеша кластеров — отдельно от хука: их берут и места без Realtime
// (отправка реакции на фрагмент).

/** Все кластеры сообщения в кеше, при любом тексте, — для перечитывания. */
export function clustersKeyOf(messageId: string) {
  return ['fragmentClusters', messageId] as const;
}

/** Отображаемые кластеры сообщения в кеше. Текст — в ключе: правка перечитывает. */
export function clustersKey(messageId: string, text: string) {
  return [...clustersKeyOf(messageId), text] as const;
}
