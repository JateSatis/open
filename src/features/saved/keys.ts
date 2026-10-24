/** Всё сохранённое человека — общий префикс: инвалидация после сохранения. */
export const savedQueryKey = ['saved'] as const;
export const savedMessagesQueryKey = ['saved', 'messages'] as const;
export const savedTagsQueryKey = ['saved', 'tags'] as const;
export const savedSummaryQueryKey = ['saved', 'summary'] as const;

export function savedSourceChatsQueryKey(chatIds: string[]) {
  return ['saved', 'source-chats', [...chatIds].sort().join(',')] as const;
}
