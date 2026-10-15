import { create } from 'zustand';

import type { TextGeometry } from '../../../../modules/text-geometry';

// Режим фрагментов и выделение текста — чисто клиентское состояние экрана
// переписки. В режиме не больше одного облачка; выделение — только в нём.
// Строки подписываются селекторами по своему ключу: переключение режима
// перерисовывает два облачка, а не весь список.

/** Выделение в облачке: диапазон UTF-16 и всё, чтобы водить ручки синхронно. */
export type TextSelection = {
  rowKey: string;
  /** Сообщение, чей текст выделен: у облачка островка — оригинал. */
  messageId: string;
  /** Чат сообщения — для комментариев и реакций оригинала островка. */
  chatId: string;
  /** Я участник чата сообщения — догадка ряда реакции; решит база. */
  amMember: boolean;
  text: string;
  start: number;
  end: number;
  geometry: TextGeometry;
  /** Угол вью текста относительно строки (её жеста): ручки — в этих координатах. */
  textInRow: { x: number; y: number };
  /** Угол вью текста в окне на момент выделения — для меню. */
  textInWindow: { x: number; y: number };
  /** Какую ручку тянут прямо сейчас: меню на это время прячется. */
  dragging: 'start' | 'end' | null;
};

/**
 * Кусок текста, к которому пришли по цитате фрагмента. Держится до первого
 * действия человека — его снимает экран переписки.
 */
export type QuoteHighlight = {
  rowKey: string;
  /** Текст, по которому снята геометрия: облачко с другим текстом её не рисует. */
  text: string;
  /** Диапазон UTF-16. */
  start: number;
  end: number;
  geometry: TextGeometry;
};

type FragmentState = {
  /** Облачко в режиме фрагментов — ключ строки. */
  activeKey: string | null;
  selection: TextSelection | null;
  quote: QuoteHighlight | null;
};

const useFragmentStore = create<FragmentState>(() => ({
  activeKey: null,
  selection: null,
  quote: null,
}));

/** Тап по облачку: то же — выйти из режима, другое — перенести режим на него. */
export function toggleFragmentMode(rowKey: string) {
  const { activeKey } = useFragmentStore.getState();

  useFragmentStore.setState({ activeKey: activeKey === rowKey ? null : rowKey, selection: null });
}

export function exitFragmentMode() {
  useFragmentStore.setState({ activeKey: null, selection: null });
}

export function getFragmentState(): FragmentState {
  return useFragmentStore.getState();
}

export function setTextSelection(selection: TextSelection | null) {
  useFragmentStore.setState({ selection });
}

/** Сдвиг выделения ручкой — без нового снимка геометрии. */
export function updateTextSelection(
  patch: Partial<Pick<TextSelection, 'start' | 'end' | 'dragging'>>,
) {
  const { selection } = useFragmentStore.getState();

  if (selection) useFragmentStore.setState({ selection: { ...selection, ...patch } });
}

export function clearTextSelection() {
  if (useFragmentStore.getState().selection) useFragmentStore.setState({ selection: null });
}

/** Облачко в режиме фрагментов — подписка одной строки. */
export function useFragmentModeActive(rowKey: string | undefined): boolean {
  return useFragmentStore((state) => rowKey !== undefined && state.activeKey === rowKey);
}

/** Выделение в этом облачке или `null`. */
export function useRowSelection(rowKey: string | undefined): TextSelection | null {
  return useFragmentStore((state) =>
    rowKey !== undefined && state.selection?.rowKey === rowKey ? state.selection : null,
  );
}

/** Есть ли выделение в этом облачке — для жестов, которым важен лишь сам факт. */
export function useRowHasSelection(rowKey: string): boolean {
  return useFragmentStore((state) => state.selection?.rowKey === rowKey);
}

/** Выделение на экране — для меню фрагмента. */
export function useTextSelection(): TextSelection | null {
  return useFragmentStore((state) => state.selection);
}

export function useFragmentActiveKey(): string | null {
  return useFragmentStore((state) => state.activeKey);
}

/** Слушать выделение вне React — жест ручек держит их положения на UI-потоке. */
export function subscribeTextSelection(listener: (selection: TextSelection | null) => void) {
  return useFragmentStore.subscribe((state, previous) => {
    if (state.selection !== previous.selection) listener(state.selection);
  });
}

export function setQuoteHighlight(quote: QuoteHighlight) {
  useFragmentStore.setState({ quote });
}

/**
 * Счётчик действий человека на экране переписки. Переход по цитате долгий
 * (догрузка истории, отрисовка): тронули экран, пока он шёл, — подсветка
 * опоздала и уже не нужна.
 */
let interactions = 0;

export function quoteInteractionMark(): number {
  return interactions;
}

/** Любое действие на экране переписки снимает подсветку. Дёшево, когда её нет. */
export function clearQuoteHighlight() {
  interactions += 1;
  if (useFragmentStore.getState().quote) useFragmentStore.setState({ quote: null });
}

/** Подсветка куска в этом облачке или `null`. */
export function useRowQuoteHighlight(rowKey: string | undefined): QuoteHighlight | null {
  return useFragmentStore((state) =>
    rowKey !== undefined && state.quote?.rowKey === rowKey ? state.quote : null,
  );
}
