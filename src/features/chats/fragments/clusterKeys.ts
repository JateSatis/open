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

/**
 * Сводка выделенной области в кеше — под ключом кластеров сообщения: что
 * перечитывает кластеры (своя реакция, пересчёт), перечитывает и её.
 */
export function areaKey(messageId: string, start: number, end: number) {
  return [...clustersKeyOf(messageId), 'area', start, end] as const;
}
