// Продуктовые лимиты канала — UX, а не инварианты схемы: база требует только
// непустое название и уникальное имя (CLAUDE.md, раздел 4). Правила имени —
// общие для людей, каналов и групп (`validateUsername`).
export const CHANNEL_TITLE_MAX_LENGTH = 50;
export const CHANNEL_DESCRIPTION_MAX_LENGTH = 255;

/** Счётчик оставшихся символов описания — когда их осталось столько или меньше. */
export const CHANNEL_DESCRIPTION_COUNTER_FROM = 50;
