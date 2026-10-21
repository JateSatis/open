import { impactAsync, ImpactFeedbackStyle, selectionAsync } from 'expo-haptics';

import { measureText } from '../../../../modules/text-geometry';

import {
  getFragmentState,
  setTextSelection,
  updateTextSelection,
  type TextSelection,
} from '@/features/chats/fragments/fragmentStore';
import { selectableTextOf } from '@/features/chats/fragments/selectableTexts';
import {
  edgeSpeed,
  scrollRoom,
  selectionScroller,
} from '@/features/chats/fragments/selectionAutoScroll';
import { caretAt, charAt, offsetAt } from '@/features/chats/fragments/textGeometry';
import {
  boundaryAtOrAfter,
  boundaryAtOrBefore,
  extendByWords,
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
 * Протяжка, которая идёт прямо сейчас: выделение словами вслед за долгим
 * нажатием или ручка. Палец — в координатах окна: пока переписка едет сама
 * (автопрокрутка), он стоит, а текст под ним сдвигается — положение пальца
 * в тексте пересчитывается от угла текста, а не новым замером.
 */
type Drag = {
  kind: 'words' | 'start' | 'end';
  rowKey: string;
  /** Где палец в окне; `null` — ещё не двигался. */
  point: { x: number; y: number } | null;
  /** Насколько палец ниже середины строки ручки: ручка не прыгает под палец. */
  lift: number;
  /** Исходное слово протяжки; `null` — геометрия ещё не пришла. */
  anchor: { start: number; end: number } | null;
  /** Палец уже отпущен, а геометрия ещё в пути: применить и закончить. */
  released: boolean;
  /** Видимая часть переписки в окне — края автопрокрутки. */
  frame: { top: number; bottom: number } | null;
};

let drag: Drag | null = null;

function startDrag(next: Drag) {
  stopAutoScroll();
  drag = next;

  const scroller = selectionScroller();

  if (!scroller) return;

  void scroller.measure().then((frame) => {
    if (drag !== next) return;

    next.frame = frame;
    autoScroll();
  });
}

/**
 * Долгое нажатие в облачке, которое в режиме фрагментов: палец на тексте —
 * выделяется слово под ним, и нажатие забрано (`true`); мимо текста — меню
 * сообщения, как обычно (`false`). Пока палец не отпущен, выделение тянется
 * за ним словами (`moveSelectionDrag`); замер текста асинхронный, и движение
 * до его прихода не теряется — применяется, как только геометрия готова.
 */
export async function beginTextSelection(rowKey: string, point: RowPoint): Promise<boolean> {
  if (getFragmentState().activeKey !== rowKey) return false;

  const entry = selectableTextOf(rowKey);
  const view = entry?.ref.current;

  if (!entry || !view) return false;

  const session: Drag = {
    kind: 'words',
    rowKey,
    point: null,
    lift: 0,
    anchor: null,
    released: false,
    frame: null,
  };

  startDrag(session);

  const drop = () => {
    if (drag === session) drag = null;

    return false;
  };

  const [geometry, origin] = await Promise.all([measureText(view), windowOrigin(view)]);

  // Текст на экране не тот, что в сообщении (успел поменяться правкой) —
  // смещения разошлись бы с базой: лучше меню, чем выделение мимо.
  if (!geometry || geometry.text !== entry.text) return drop();

  const char = charAt(geometry, point.x - origin.x, point.y - origin.y);

  if (char === null) return drop();

  const word = wordAt(entry.text, char);

  if (word.end <= word.start || !entry.text.slice(word.start, word.end).trim()) return drop();

  // Пока мерили, режим могли снять или перенести.
  if (getFragmentState().activeKey !== rowKey) return drop();

  const live = drag === session;

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
    dragging: live && !session.released ? 'words' : null,
  });

  if (live) {
    session.anchor = word;
    applyDrag(false);

    if (session.released) endSelectionDrag('words');
    else autoScroll();
  }

  return true;
}

/**
 * Ручку схватили: дальше её ведёт `moveSelectionDrag`. Угол текста в окне
 * перемеряется: с выделения строка могла сдвинуться не пальцем (клавиатура,
 * новое сообщение внизу), и ручка прыгнула бы на этот сдвиг.
 */
export function beginHandleDrag(rowKey: string, edge: 'start' | 'end', lift: number) {
  const session: Drag = {
    kind: edge,
    rowKey,
    point: null,
    lift,
    anchor: null,
    released: false,
    frame: null,
  };

  startDrag(session);
  updateTextSelection({ dragging: edge });

  const view = selectableTextOf(rowKey)?.ref.current;

  if (!view) return;

  void windowOrigin(view).then((origin) => {
    if (drag !== session || getFragmentState().selection?.rowKey !== rowKey) return;

    updateTextSelection({ textInWindow: origin });
    applyDrag(false);
  });
}

/** Палец протяжки сдвинулся — координаты окна. Без протяжки ничего не делает. */
export function moveSelectionDrag(x: number, y: number) {
  if (!drag) return;

  drag.point = { x, y };
  applyDrag(true);
  autoScroll();
}

/**
 * Палец отпущен: выделение остаётся, возвращаются меню и ручки. `by` — чей
 * жест кончился: долгое нажатие строки кончается (отказом) и тогда, когда
 * касание забрала ручка, — чужую протяжку оно не обрывает.
 */
export function endSelectionDrag(by: 'words' | 'handle') {
  const session = drag;

  if (!session || (session.kind === 'words') !== (by === 'words')) return;

  // Геометрия ещё в пути — закончит `beginTextSelection`, когда придёт.
  if (session.kind === 'words' && session.anchor === null) {
    session.released = true;
    return;
  }

  drag = null;
  stopAutoScroll();

  if (getFragmentState().selection?.dragging) updateTextSelection({ dragging: null });
}

/** Перевести палец в текст и сдвинуть выделение. */
function applyDrag(buzz: boolean) {
  const session = drag;
  const { selection } = getFragmentState();

  if (!session?.point || !selection || selection.rowKey !== session.rowKey) return;

  const x = session.point.x - selection.textInWindow.x;
  const y = session.point.y - selection.textInWindow.y - session.lift;

  if (session.kind !== 'words') {
    dragHandle(session.kind, x, y);
    return;
  }

  if (!session.anchor) return;

  const char = charAt(selection.geometry, x, y, true);

  if (char === null) return;

  const range = extendByWords(selection.text, boundsOf(selection.text), session.anchor, char);

  if (range.start === selection.start && range.end === selection.end) return;

  if (buzz) selectionAsync().catch(() => undefined);
  updateTextSelection(range);
}

let frameRequest: number | null = null;
let lastFrameAt = 0;

function stopAutoScroll() {
  if (frameRequest !== null) cancelAnimationFrame(frameRequest);
  frameRequest = null;
}

/** Палец у края переписки — запустить прокрутку, если она ещё не идёт. */
function autoScroll() {
  if (frameRequest !== null) return;

  lastFrameAt = 0;
  frameRequest = requestAnimationFrame(scrollFrame);
}

function scrollFrame(now: number) {
  frameRequest = null;

  const session = drag;
  const scroller = selectionScroller();
  const { selection } = getFragmentState();

  if (!session?.point || !session.frame || !scroller || !selection) return;
  if (session.kind === 'words' && !session.anchor) return;

  const speed = edgeSpeed(session.point.y, session.frame);
  const top = selection.textInWindow.y;
  const room = scrollRoom(speed, { top, bottom: top + selection.geometry.height }, session.frame);

  if (speed === 0 || room === 0) return;

  // Первый кадр — без шага: время между кадрами ещё неизвестно.
  const elapsed = lastFrameAt === 0 ? 0 : Math.min(now - lastFrameAt, 50);

  lastFrameAt = now;

  const want = (speed * elapsed) / 1000;
  const moved =
    want === 0 ? 0 : scroller.scrollBy(speed > 0 ? Math.min(want, room) : Math.max(want, room));

  if (elapsed > 0 && moved === 0) return;

  if (moved !== 0) {
    updateTextSelection({
      textInWindow: { x: selection.textInWindow.x, y: selection.textInWindow.y + moved },
    });
    applyDrag(true);
  }

  frameRequest = requestAnimationFrame(scrollFrame);
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
