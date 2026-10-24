// Фильтры «Сохранённых»: что выбрал человек (клиентское состояние экрана)
// и как это уходит на сервер. Решает, подходит ли запись, база
// (`saved_matches`), а здесь — только перевод выбора в параметры, подписи
// чипов и ключ кеша.

import type { SavedCategory, SavedFilterInput, SavedTypeFilter } from '@/api/saved';

/** Выбор в листе фильтров. Даты — дни `YYYY-MM-DD` в поясе устройства. */
export type SavedFilters = {
  tags: string[];
  categories: SavedCategory[];
  types: SavedTypeFilter[];
  from: string | null;
  to: string | null;
};

export const NO_FILTERS: SavedFilters = { tags: [], categories: [], types: [], from: null, to: null };

/** Источники в листе и на чипах — в этом порядке. */
export const CATEGORY_LABELS: readonly { value: SavedCategory; label: string }[] = [
  { value: 'channel', label: 'Каналы' },
  { value: 'member', label: 'Свои чаты' },
  { value: 'visitor', label: 'Чужие чаты' },
  { value: 'note', label: 'Мои заметки' },
];

export const TYPE_LABELS: readonly { value: SavedTypeFilter; label: string }[] = [
  { value: 'text_media', label: 'Текст и медиа' },
  { value: 'voice', label: 'Голосовое' },
  { value: 'pop', label: 'Попсы' },
];

const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

export function hasFilters(filters: SavedFilters): boolean {
  return (
    filters.tags.length > 0 ||
    filters.categories.length > 0 ||
    filters.types.length > 0 ||
    filters.from !== null ||
    filters.to !== null
  );
}

function parseDay(day: string): { year: number; month: number; date: number } {
  const [year, month, date] = day.split('-').map(Number);

  return { year, month, date };
}

/** Начало дня `day` в поясе устройства, `shift` дней спустя. */
function dayStart(day: string, shift = 0): string {
  const { year, month, date } = parseDay(day);

  return new Date(year, month - 1, date + shift).toISOString();
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `YYYY-MM-DD` дня, в который попадает момент, — в поясе устройства. */
export function toDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Параметры для базы: пустые группы не передаются, «до» — включительно
 * (начало следующего дня), поиск — поверх фильтров. Нечего передавать — `null`.
 */
export function toFilterInput(filters: SavedFilters, query = ''): SavedFilterInput | null {
  const input: SavedFilterInput = {};
  const q = query.trim();

  if (filters.tags.length > 0) input.tags = [...filters.tags].sort();
  if (filters.categories.length > 0) input.categories = [...filters.categories].sort();
  if (filters.types.length > 0) input.types = [...filters.types].sort();
  if (filters.from) input.from = dayStart(filters.from);
  if (filters.to) input.to = dayStart(filters.to, 1);
  if (q !== '') input.q = q;

  return Object.keys(input).length > 0 ? input : null;
}

/** Ключ кеша списка под фильтром: одинаковый выбор — один кеш. Без фильтра — `null`. */
export function filterKey(input: SavedFilterInput | null): string | null {
  return input ? JSON.stringify(input) : null;
}

/** Фильтр обратно из ключа кеша — для правок загруженных списков. */
export function filterOfKey(key: unknown): SavedFilterInput | null {
  if (typeof key !== 'string') return null;

  try {
    return JSON.parse(key) as SavedFilterInput;
  } catch {
    return null;
  }
}

function shortDay(day: string): string {
  const { month, date } = parseDay(day);

  return `${pad(date)}.${pad(month)}`;
}

/**
 * Подпись чипа дат: целый календарный месяц — «Август» (не текущего года —
 * «Август 2025»), один день — «06.11», иначе «01.08–15.08», «с 01.08», «до 15.08».
 */
export function dateChipLabel(
  from: string | null,
  to: string | null,
  now: Date = new Date(),
): string | null {
  if (from && to) {
    const start = parseDay(from);
    const end = parseDay(to);
    const lastDay = new Date(end.year, end.month, 0).getDate();

    if (
      start.year === end.year &&
      start.month === end.month &&
      start.date === 1 &&
      end.date === lastDay
    ) {
      const month = MONTHS[start.month - 1];

      return start.year === now.getFullYear() ? month : `${month} ${start.year}`;
    }

    if (from === to) return shortDay(from);

    return `${shortDay(from)}–${shortDay(to)}`;
  }

  if (from) return `с ${shortDay(from)}`;
  if (to) return `до ${shortDay(to)}`;

  return null;
}

/** Чип строки активных фильтров: подпись, тег (для цвета) и как его снять. */
export type FilterChip =
  | { key: string; kind: 'dates'; label: string }
  | { key: string; kind: 'type'; label: string; value: SavedTypeFilter }
  | { key: string; kind: 'category'; label: string; value: SavedCategory }
  | { key: string; kind: 'tag'; tagId: string };

/** Чипы по порядку: даты, типы, источники, теги. */
export function filterChips(filters: SavedFilters, now: Date = new Date()): FilterChip[] {
  const chips: FilterChip[] = [];
  const dates = dateChipLabel(filters.from, filters.to, now);

  if (dates) chips.push({ key: 'dates', kind: 'dates', label: dates });

  for (const { value, label } of TYPE_LABELS)
    if (filters.types.includes(value))
      chips.push({ key: `type:${value}`, kind: 'type', label, value });

  for (const { value, label } of CATEGORY_LABELS)
    if (filters.categories.includes(value))
      chips.push({ key: `category:${value}`, kind: 'category', label, value });

  for (const tagId of filters.tags) chips.push({ key: `tag:${tagId}`, kind: 'tag', tagId });

  return chips;
}

/**
 * Подходит ли запись по тому, что может измениться у загруженной записи, —
 * её тегам. Источник, вид и дата сохранения у записи не меняются, а значит
 * запись в отфильтрованном списке по ним уже подходит.
 */
export function tagsStillMatch(tagIds: readonly string[], input: SavedFilterInput | null): boolean {
  if (!input?.tags || input.tags.length === 0) return true;

  return tagIds.some((id) => input.tags?.includes(id));
}
