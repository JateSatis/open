import { impactAsync, ImpactFeedbackStyle } from 'expo-haptics';

import { measureText } from '../../../../modules/text-geometry';

import {
  getFragmentState,
  setTextSelection,
  updateTextSelection,
  type TextSelection,
} from '@/features/chats/fragments/fragmentStore';
import { selectableTextOf } from '@/features/chats/fragments/selectableTexts';
import { caretAt, charAt, offsetAt } from '@/features/chats/fragments/textGeometry';
import {
  boundaryAtOrAfter,
  boundaryAtOrBefore,
  graphemeBoundaries,
  snapToBoundary,
  wordAt,
} from '@/features/chats/fragments/textOffsets';
import { Sizes } from '@/theme';

/** Касание долгого нажатия: в окне и в координатах строки (её жеста). */
export type RowPoint = { x: number; y: number; localX: number; localY: number };

function windowOrigin(view: { measureInWindow: (cb: (x: number, y: number) => void) => void }) {
  return new Promise<{ x: number; y: number }>((resolve) =>
    view.measureInWindow((x, y) => resolve({ x, y })),
  );
}

/**
 * Долгое нажатие в облачке, которое в режиме фрагментов: палец на тексте —
 * выделяется слово под ним, и нажатие забрано (`true`); мимо текста — меню
 * сообщения, как обычно (`false`).
 */
export async function beginTextSelection(rowKey: string, point: RowPoint): Promise<boolean> {
  if (getFragmentState().activeKey !== rowKey) return false;

  const entry = selectableTextOf(rowKey);
  const view = entry?.ref.current;

  if (!entry || !view) return false;

  const [geometry, origin] = await Promise.all([measureText(view), windowOrigin(view)]);

  // Текст на экране не тот, что в сообщении (успел поменяться правкой) —
  // смещения разошлись бы с базой: лучше меню, чем выделение мимо.
  if (!geometry || geometry.text !== entry.text) return false;

  const char = charAt(geometry, point.x - origin.x, point.y - origin.y);

  if (char === null) return false;

  const word = wordAt(entry.text, char);

  if (word.end <= word.start || !entry.text.slice(word.start, word.end).trim()) return false;

  // Пока мерили, режим могли снять или перенести.
  if (getFragmentState().activeKey !== rowKey) return false;

  impactAsync(ImpactFeedbackStyle.Light).catch(() => undefined);
  setTextSelection({
    rowKey,
    messageId: entry.messageId,
    chatId: entry.chatId,
    amMember: entry.amMember,
    text: entry.text,
    start: word.start,
    end: word.end,
    geometry,
    // Угол строки в окне — касание в окне минус касание в строке.
    textInRow: { x: origin.x - (point.x - point.localX), y: origin.y - (point.y - point.localY) },
    textInWindow: origin,
    dragging: null,
  });

  return true;
}

/** Где ручки — в координатах строки: жест ручек проверяет касание на UI-потоке. */
export type HandleSpots = {
  /** Угол текста в строке. */
  originX: number;
  originY: number;
  start: { x: number; top: number; bottom: number };
  end: { x: number; top: number; bottom: number };
};

export function handleSpots(selection: TextSelection): HandleSpots {
  return {
    originX: selection.textInRow.x,
    originY: selection.textInRow.y,
    start: caretAt(selection.geometry, selection.start, 'start'),
    end: caretAt(selection.geometry, selection.end, 'end'),
  };
}

/**
 * Какую ручку хватает касание (в координатах текста): 1 — начало, 2 — конец,
 * 0 — никакую. Хватает капля под строкой и стержень вдоль неё — ручка тонкая,
 * палец толстый. Ворклет: решение нужно в момент касания.
 */
export function hitHandle(spots: HandleSpots, x: number, y: number): 0 | 1 | 2 {
  'worklet';

  let best: 0 | 1 | 2 = 0;
  let bestDistance: number = Sizes.selectionHandleHit;
  const carets = [spots.start, spots.end];

  for (let i = 0; i < 2; i++) {
    const caret = carets[i];
    const dropY = caret.bottom + Sizes.selectionHandle / 2;
    const onDrop = Math.hypot(x - caret.x, y - dropY);
    const onStem = y >= caret.top && y <= caret.bottom ? Math.abs(x - caret.x) : Infinity;
    const distance = Math.min(onDrop, onStem);

    if (distance <= bestDistance) {
      best = i === 0 ? 1 : 2;
      bestDistance = distance;
    }
  }

  return best;
}

const boundsCache = new Map<string, number[]>();

function boundsOf(text: string): number[] {
  let bounds = boundsCache.get(text);

  if (!bounds) {
    bounds = graphemeBoundaries(text);
    boundsCache.clear();
    boundsCache.set(text, bounds);
  }

  return bounds;
}

/**
 * Ручку тянут в точку (координаты текста, уже поправленные на то, где палец
 * держит каплю). Края ходят только по границам графем и не сходятся: в
 * выделении всегда остаётся хотя бы один символ.
 */
export function dragHandle(edge: 'start' | 'end', x: number, y: number) {
  const { selection } = getFragmentState();

  if (!selection) return;

  const raw = offsetAt(selection.geometry, x, y, true);

  if (raw === null) return;

  const bounds = boundsOf(selection.text);
  const at = snapToBoundary(bounds, raw);

  if (edge === 'start') {
    const start = Math.min(at, boundaryAtOrBefore(bounds, selection.end - 1));

    if (start !== selection.start) updateTextSelection({ start });
  } else {
    const end = Math.max(at, boundaryAtOrAfter(bounds, selection.start + 1));

    if (end !== selection.end) updateTextSelection({ end });
  }
}
