// Поиск в журнале: какой запрос человек задал и что открыл из выдачи, с
// какого места. Запрос — нормализованный текст: без лишних пробелов, в
// нижнем регистре.

import { journal, type JournalSubjectType } from './journal';

export type SearchScope = 'chats' | 'feed';

export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Выдача по запросу пришла. Тот же запрос подряд — одно событие. */
const lastQuery: Record<SearchScope, string> = { chats: '', feed: '' };

export function logSearchQuery(
  scope: SearchScope,
  query: string,
  counts: Record<string, number>,
): void {
  const text = normalizeQuery(query);

  if (!text || lastQuery[scope] === text) return;

  lastQuery[scope] = text;
  journal.log('search_query', {
    surface: 'search',
    data: { scope, query: text.slice(0, 200), ...counts },
  });
}

export function logSearchResultOpened(
  scope: SearchScope,
  subject: { type: JournalSubjectType; id: string },
  result: { kind: string; section: string; position: number; query: string },
): void {
  journal.log('search_result_opened', {
    subject,
    surface: 'search',
    data: {
      scope,
      kind: result.kind,
      section: result.section,
      position: result.position,
      query: normalizeQuery(result.query).slice(0, 200),
    },
  });
}
