// Правка текста поля из панели эмодзи: вставка в место курсора и «стереть».
// Курсор и выделение — в UTF-16, как их отдаёт `onSelectionChange`.

import { boundaryAtOrBefore, graphemeBoundaries } from '@/features/chats/fragments/textOffsets';

export type Selection = { start: number; end: number };
export type Edited = { text: string; selection: Selection };

function clampSelection(text: string, selection: Selection): Selection {
  const start = Math.max(0, Math.min(selection.start, selection.end, text.length));
  const end = Math.max(start, Math.min(Math.max(selection.start, selection.end), text.length));

  return { start, end };
}

/** Эмодзи на место курсора (или вместо выделенного); курсор — сразу за ним. */
export function insertAt(text: string, selection: Selection, emoji: string): Edited {
  const { start, end } = clampSelection(text, selection);
  const cursor = start + emoji.length;

  return {
    text: text.slice(0, start) + emoji + text.slice(end),
    selection: { start: cursor, end: cursor },
  };
}

/**
 * «Стереть», как клавиша клавиатуры: выделение — удаляется целиком, иначе —
 * один символ перед курсором. Символ — графема: эмодзи с оттенком кожи,
 * семья из нескольких человек, флаг уходят за одно нажатие, а не по частям.
 * Стирать нечего — `null`.
 */
export function deleteBefore(text: string, selection: Selection): Edited | null {
  const { start, end } = clampSelection(text, selection);

  if (start !== end) {
    return { text: text.slice(0, start) + text.slice(end), selection: { start, end: start } };
  }

  if (start === 0) return null;

  const from = boundaryAtOrBefore(graphemeBoundaries(text), start - 1);

  return {
    text: text.slice(0, from) + text.slice(start),
    selection: { start: from, end: from },
  };
}
