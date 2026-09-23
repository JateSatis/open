import { create } from 'zustand';

import { MediaLimits } from './constants';
import type { MediaLibraryItem } from './mediaLibrary';

type SelectionState = {
  /** Порядок выбора — он же нумерация кружков. */
  order: string[];
  items: Record<string, MediaLibraryItem>;
  toggle: (asset: MediaLibraryItem) => void;
  clear: () => void;
};

/**
 * Выбранные в гриде файлы.
 *
 * Отдельный стор, а не состояние экрана чата, ровно по одной причине: тап по
 * кружку обязан перерисовать одну клетку. Пока выбор жил в черновике, один
 * тап перерисовывал экран чата целиком, за ним шит, за ним грид, а дальше
 * `FlatList` заново проходил по всему видимому окну — замер показал 390
 * рендеров клеток на открытие и 200 на закрытие. Клетка подписывается на свой
 * номер и на то, добран ли лимит, и реагирует только на изменение этих двух
 * чисел.
 *
 * Черновик сообщения (`useComposerDraft`) читает отсюда, а не наоборот.
 */
export const useMediaSelection = create<SelectionState>((set) => ({
  order: [],
  items: {},

  toggle: (asset) =>
    set((state) => {
      if (state.order.includes(asset.id)) {
        const { [asset.id]: _removed, ...items } = state.items;

        return { order: state.order.filter((id) => id !== asset.id), items };
      }

      if (state.order.length >= MediaLimits.gallery.maxSelection) return state;

      return {
        order: [...state.order, asset.id],
        items: { ...state.items, [asset.id]: asset },
      };
    }),

  clear: () => set({ order: [], items: {} }),
}));

/** Клетка не выбрана, но выбрать её можно. */
export const SLOT_FREE = 0;
/** Клетка не выбрана, и лимит альбома уже добран. */
export const SLOT_BLOCKED = -1;

/**
 * Всё, что клетке нужно знать о выборе, одним числом: `> 0` — её номер,
 * `SLOT_FREE` — можно выбрать, `SLOT_BLOCKED` — лимит добран.
 *
 * Именно одним числом, а не объектом и не двумя подписками. Объект ломал бы
 * сравнение по ссылке, и любое изменение стора перерисовывало бы все клетки;
 * две подписки — это два слушателя и два пересчёта на клетку вместо одного,
 * а клеток в окне списка десятки.
 */
export function useSelectionSlot(id: string): number {
  return useMediaSelection((state) => {
    const index = state.order.indexOf(id);

    if (index !== -1) return index + 1;

    return state.order.length >= MediaLimits.gallery.maxSelection ? SLOT_BLOCKED : SLOT_FREE;
  });
}

/** Сколько файлов выбрано. Подписываться на число дешевле, чем на сам список. */
export function useSelectionCount(): number {
  return useMediaSelection((state) => state.order.length);
}

/**
 * Есть ли выбор вообще. Шиту нужен именно факт, а не число: на счётчике он
 * перерисовывался бы на каждый тап, а вместе с ним — и весь список, потому
 * что его шапка и хвост пересоздаются при каждом рендере шита.
 */
export function useHasSelection(): boolean {
  return useMediaSelection((state) => state.order.length > 0);
}

/** Выбранное в порядке выбора. Для отправки, а не для отрисовки. */
export function selectedAssets(): MediaLibraryItem[] {
  const { order, items } = useMediaSelection.getState();

  return order.map((id) => items[id]).filter((item) => item !== undefined);
}
