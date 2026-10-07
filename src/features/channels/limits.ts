// Продуктовые лимиты канала — UX, а не инварианты схемы: база требует только
// непустое название и уникальное имя (CLAUDE.md, раздел 4). Формат имени —
// общий с профилем (`validateUsername`), пространство имён у них одно.
export const CHANNEL_TITLE_MAX_LENGTH = 50;
export const CHANNEL_DESCRIPTION_MAX_LENGTH = 255;

/** Сколько ждать после последней буквы, прежде чем спрашивать сервер о занятости имени. */
export const USERNAME_CHECK_DELAY_MS = 400;
