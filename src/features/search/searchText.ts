// Клиентская половина правил поиска — те же, что у базы (миграция
// `20261016100000_search.sql`): регистр, ё/е, диакритика латиницы, пробелы,
// разбор `@` и суффикса `.ch` / `.di`, уровни совпадения. Нужна для
// мгновенного прогона по своим чатам из кеша и для подсветки совпавшего в
// строках выдачи. Нечёткого уровня тут нет: опечатки находит только сервер.

export type SearchKindFilter = 'channel' | 'group' | null;

export type ParsedQuery = {
  /** Нормализованный текст без `@` и суффикса: для названий и сообщений. */
  text: string;
  /** Запрос, похожий на @имя (латиница, цифры, `_`), в нижнем регистре; иначе null. */
  username: string | null;
  /** `@` впереди: совпадения по @имени важнее совпадений по названию. */
  byUsername: boolean;
  /** `.ch` — только каналы, `.di` — только группы. */
  kind: SearchKindFilter;
};

/** Отрезок исходной строки `[start, end)`. */
export type TextRange = { start: number; end: number };

const LATIN_MARKS = /[\u0300-\u036f]/g;
const WHITESPACE = /\s/;
// Буквы латиницы, кириллицы и цифры. Явным списком, а не `\p{L}`: на
// классах Юникода Hermes спотыкается чаще, чем на диапазонах.
const WORD_CHARS = 'A-Za-z0-9\u00C0-\u024F\u0400-\u04FF';
const WORD_CHAR = new RegExp(`[${WORD_CHARS}]`);
const NON_WORD = new RegExp(`[^${WORD_CHARS}]+`, 'g');

/** Один символ — к виду для сравнения. Может стать пустым (знак ударения) или длиннее. */
function normalizeChar(char: string): string {
  const lower = char.toLowerCase();

  if (lower === 'ё') return 'е';
  // Диакритика снимается только у латиницы: «й» в базе остаётся «й».
  if (lower.charCodeAt(0) < 0x0250) return lower.normalize('NFD').replace(LATIN_MARKS, '');

  return lower;
}

type Normalized = { text: string; origin: number[] };

/**
 * Нормализованная строка и для каждого её символа — индекс символа исходной
 * строки, из которого он вышел. По нему подсветка возвращается к оригиналу.
 */
function normalizeWithMap(value: string): Normalized {
  let text = '';
  const origin: number[] = [];
  let pendingSpace = -1;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (WHITESPACE.test(char)) {
      if (text.length > 0 && pendingSpace === -1) pendingSpace = index;
      continue;
    }

    if (pendingSpace !== -1) {
      text += ' ';
      origin.push(pendingSpace);
      pendingSpace = -1;
    }

    for (const piece of normalizeChar(char)) {
      text += piece;
      origin.push(index);
    }
  }

  return { text, origin };
}

/** То же, что `search_norm` в базе. */
export function normalizeSearch(value: string): string {
  return normalizeWithMap(value).text;
}

/** Разбор запроса — как `search_parse` в базе. */
export function parseSearchQuery(query: string): ParsedQuery {
  let rest = query.trim();
  const byUsername = rest.startsWith('@');

  rest = rest.replace(/^@+/, '').trim();

  let kind: SearchKindFilter = null;
  const lowered = rest.toLowerCase();

  if (lowered.endsWith('.ch')) {
    kind = 'channel';
    rest = rest.slice(0, -3);
  } else if (lowered.endsWith('.di')) {
    kind = 'group';
    rest = rest.slice(0, -3);
  }

  const username = /^[a-z0-9_]+$/.test(rest.toLowerCase()) ? rest.toLowerCase() : null;

  return { text: normalizeSearch(rest), username, byUsername, kind };
}

function words(value: string): string {
  return value.replace(NON_WORD, ' ').trim();
}

/**
 * Уровень совпадения — как `search_level` в базе, без нечёткого:
 * 4 — точное, 3 — с начала слова, 2 — внутри слова, 0 — нет.
 */
export function matchLevel(field: string | null, needle: string | null): number {
  if (!field || !needle) return 0;

  const normalized = normalizeSearch(field);

  if (normalized === needle) return 4;

  const needleWords = words(needle);

  if (needleWords && ` ${words(normalized)}`.includes(` ${needleWords}`)) return 3;
  if (normalized.includes(needle)) return 2;

  return 0;
}

function isWordStart(text: string, index: number): boolean {
  return index === 0 || !WORD_CHAR.test(text[index - 1]);
}

function occurrences(haystack: string, needle: string, atWordStart: boolean): TextRange[] {
  const found: TextRange[] = [];

  if (!needle) return found;

  let from = 0;

  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);

    if (at === -1) break;
    if (!atWordStart || isWordStart(haystack, at)) {
      found.push({ start: at, end: at + needle.length });
    }
    from = at + 1;
  }

  return found;
}

/**
 * Сколько от начала слова подсвечивать, если слово запроса в тексте стоит в
 * другой форме: «сообщения» в «сообщение» — общая основа «сообщени». Не
 * короче трёх букв и не меньше трёх пятых слова — иначе подсветится
 * случайное.
 */
function stemRanges(haystack: string, word: string): TextRange[] {
  const shortest = Math.max(3, Math.ceil(word.length * 0.6));

  for (let length = word.length - 1; length >= shortest; length -= 1) {
    const found = occurrences(haystack, word.slice(0, length), true);

    if (found.length > 0) return found;
  }

  return [];
}

function merge(ranges: TextRange[]): TextRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: TextRange[] = [];

  for (const range of sorted) {
    const last = merged[merged.length - 1];

    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }

  return merged;
}

/**
 * Что подсветить в `text` по нормализованному запросу `needle`: сам запрос
 * целиком, а если его нет — каждое слово запроса с начала слова текста, в
 * крайнем случае его основу. Отрезки — в индексах исходной строки.
 */
export function findMatches(text: string, needle: string): TextRange[] {
  if (!text || !needle) return [];

  const normalized = normalizeWithMap(text);
  let found = occurrences(normalized.text, needle, false);

  if (found.length === 0) {
    for (const word of words(needle).split(' ')) {
      if (!word) continue;

      const exact = occurrences(normalized.text, word, true);

      found.push(...(exact.length > 0 ? exact : stemRanges(normalized.text, word)));
    }
  }

  return merge(
    found.map(({ start, end }) => ({
      start: normalized.origin[start],
      end: normalized.origin[end - 1] + 1,
    })),
  );
}

export type Snippet = { text: string; ranges: TextRange[] };

/** Сколько символов текста оставить перед первым совпадением. */
export const SNIPPET_LEAD = 24;

/**
 * Длинное сообщение — фрагментом вокруг первого совпадения, а не началом: с
 * границы слова чуть раньше совпадения, с многоточием. Переносы строк —
 * пробелами: фрагмент показывается в две строки.
 */
export function snippetAround(text: string, ranges: TextRange[], lead = SNIPPET_LEAD): Snippet {
  const flat = text.replace(/\s/g, ' ');
  const first = ranges[0];

  if (!first || first.start <= lead) return { text: flat, ranges };

  let start = first.start - lead;

  while (start < first.start && flat[start] !== ' ') start += 1;
  start = start < first.start ? start + 1 : first.start;

  const prefix = '…';
  const shift = start - prefix.length;

  return {
    text: prefix + flat.slice(start),
    ranges: ranges
      .filter((range) => range.end > start)
      .map((range) => ({
        start: Math.max(range.start, start) - shift,
        end: range.end - shift,
      })),
  };
}
