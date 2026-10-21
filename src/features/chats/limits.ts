// Продуктовые лимиты группы. Не инварианты: у базы граница грубее, против
// мусора, а не ради удобства (см. раздел 4 CLAUDE.md).

/** Длиннее название в шапке не читается. */
export const GROUP_TITLE_MAX_LENGTH = 80;

/** Описание — пара абзацев, как у канала. */
export const GROUP_DESCRIPTION_MAX_LENGTH = 255;

/** Счётчик оставшихся символов описания — когда их осталось столько или меньше. */
export const GROUP_DESCRIPTION_COUNTER_FROM = 50;

/** Дальше этого `count_chat_search` не считает: «из 1000+». */
export const CHAT_SEARCH_COUNT_CAP = 1000;

/** Заявка на диалог — короткое знакомство, а не письмо. */
export const DIALOGUE_REQUEST_MAX_LENGTH = 500;

/** Счётчик оставшихся символов заявки — когда их осталось столько или меньше. */
export const DIALOGUE_REQUEST_COUNTER_FROM = 100;
