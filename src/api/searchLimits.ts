// Без зависимостей: им пользуются экраны выбора людей, а тесты, где API
// замокан, не должны тянуть клиент Supabase.

/**
 * Код отказа по частоте: поиск и списки людей ограничены на сервере
 * (миграция `20261030120000_privacy_search.sql`) — защита от перебора всех
 * пользователей, а не продуктовый лимит.
 */
const SEARCH_RATE_LIMIT_CODE = 'OPN06';

/** Сервер отказал: слишком много запросов поиска подряд. */
export function isSearchRateLimited(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === SEARCH_RATE_LIMIT_CODE
  );
}

/** Что сказать человеку, упёршемуся в лимит частоты поиска. */
export const SEARCH_RATE_LIMIT_TEXT =
  'Слишком много запросов поиска подряд. Подождите минуту и попробуйте снова.';
