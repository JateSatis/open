/** Всё сохранённое человека — общий префикс: инвалидация после сохранения. */
export const savedQueryKey = ['saved'] as const;
/**
 * Списки без фильтра — ровно эти ключи, под фильтром — с ключом фильтра
 * третьим элементом (`savedFilters.filterKey`). Правки кеша идут по префиксу
 * и задевают оба.
 */
export const savedMessagesQueryKey = ['saved', 'messages'] as const;
export const savedWatchLaterQueryKey = ['saved', 'watch-later'] as const;
export const savedPinsQueryKey = ['saved', 'pins'] as const;
export const savedTagsQueryKey = ['saved', 'tags'] as const;
export const savedSummaryQueryKey = ['saved', 'summary'] as const;

type FilteredKey<K extends readonly string[]> = K | readonly [...K, string];

function filtered<K extends readonly string[]>(base: K, key: string | null): FilteredKey<K> {
  return key === null ? base : ([...base, key] as const);
}

export function savedMessagesKey(filter: string | null) {
  return filtered(savedMessagesQueryKey, filter);
}

export function savedWatchLaterKey(filter: string | null) {
  return filtered(savedWatchLaterQueryKey, filter);
}

export function savedPinsKey(filter: string | null) {
  return filtered(savedPinsQueryKey, filter);
}

export function savedSourceChatsQueryKey(chatIds: string[]) {
  return ['saved', 'source-chats', [...chatIds].sort().join(',')] as const;
}
