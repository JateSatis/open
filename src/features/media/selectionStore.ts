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

/** Номер файла в выборе (с единицы) или `null`, если он не выбран. */
export function useSelectionOrder(id: string): number | null {
  return useMediaSelection((state) => {
    const index = state.order.indexOf(id);

    return index === -1 ? null : index + 1;
  });
}

/** Лимит альбома добран — новые файлы больше не принимаются. */
export function useSelectionIsFull(): boolean {
  return useMediaSelection((state) => state.order.length >= MediaLimits.gallery.maxSelection);
}

/** Сколько файлов выбрано. Подписываться на число дешевле, чем на сам список. */
export function useSelectionCount(): number {
  return useMediaSelection((state) => state.order.length);
}

/** Выбранное в порядке выбора. Для отправки, а не для отрисовки. */
export function selectedAssets(): MediaLibraryItem[] {
  const { order, items } = useMediaSelection.getState();

  return order.map((id) => items[id]).filter((item) => item !== undefined);
}
