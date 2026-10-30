import type { SavedMessage } from '@/api/saved';
import { describePreview, previewOf } from '@/features/chats/messageQuote';
import { toBubbleMessage } from '@/features/saved/savedCopy';
import { findMatches } from '@/features/search/searchText';

/**
 * Текст записи, где искали: текст копии или заметки, а если совпало
 * название попа — оно. Ни там ни там (совпадение по форме слова) — текст
 * или превью записи.
 */
export function savedSearchText(saved: SavedMessage, needle: string): string {
  const text = saved.text ?? '';

  if (text !== '' && findMatches(text, needle).length > 0) return text;
  if (saved.popTitle && findMatches(saved.popTitle, needle).length > 0) return saved.popTitle;

  return text !== '' ? text : describePreview(previewOf(toBubbleMessage(saved)));
}
