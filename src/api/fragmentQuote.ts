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

// Фрагмент спит, только когда у него нет ни реакций, ни живых комментариев,
// так что у живого комментария он читается всегда — кроме удалённого
// сообщения: тогда SELECT-политика прячет его вместе с текстом. Спящий
// бывает лишь под заглушкой удалённого корня, а у неё цитаты и нет.
export const FRAGMENT_QUOTE_COLUMNS =
  'fragment:message_fragments!comments_fragment_fkey(start_offset, end_offset, exact_text, anchor_state)' as const;

type FragmentQuoteRow = {
  start_offset: number;
  end_offset: number;
  exact_text: string;
  anchor_state: string;
};

/** Цитата комментария; `null` — комментарий не к фрагменту или фрагмент не читается. */
export function toFragmentQuote(
  fragmentId: string | null,
  row: FragmentQuoteRow | null,
): FragmentQuote | null {
  return fragmentId && row
    ? {
        text: row.exact_text,
        start: row.start_offset,
        end: row.end_offset,
        lost: row.anchor_state === 'lost',
      }
    : null;
}
