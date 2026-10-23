// Цитата фрагмента у комментария к нему — встроенной выборкой рядом с
// колонками комментария: и в шите, и у пересланного комментария в переписке.
// Отдельно от `comments.ts`, чтобы выборка сообщений (`messageRows`) брала её
// без кругового импорта.

/**
 * `text` — кусок, каким его выделили (`exact_text`): правка сообщения его не
 * меняет. `start`/`end` — где он сейчас, в code points; `lost` — правка
 * унесла его из текста.
 */
export type FragmentQuote = { text: string; start: number; end: number; lost: boolean };

// Цитата — из `fragment_rows`: якорь глазами смотрящего, скрытое автором
// зрителю приходит замазанным (этап 6 приватности).
//
// Фрагмент спит, только когда у него нет ни реакций, ни живых комментариев,
// так что у живого комментария он читается всегда — кроме удалённого
// сообщения: тогда SELECT-политика прячет его вместе с текстом. Спящий
// бывает лишь под заглушкой удалённого корня, а у неё цитаты и нет.
export const FRAGMENT_QUOTE_COLUMNS =
  'fragment:fragment_rows!comments_fragment_fkey(start_offset, end_offset, exact_text, anchor_state)' as const;

// Колонки представления генератор типов размечает nullable целиком.
type FragmentQuoteRow = {
  start_offset: number | null;
  end_offset: number | null;
  exact_text: string | null;
  anchor_state: string | null;
};

/** Цитата комментария; `null` — комментарий не к фрагменту или фрагмент не читается. */
export function toFragmentQuote(
  fragmentId: string | null,
  row: FragmentQuoteRow | null,
): FragmentQuote | null {
  return fragmentId && row && row.exact_text !== null
    ? {
        text: row.exact_text,
        start: row.start_offset ?? 0,
        end: row.end_offset ?? 0,
        lost: row.anchor_state === 'lost',
      }
    : null;
}
