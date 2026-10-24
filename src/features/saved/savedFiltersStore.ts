// Фильтры «Сохранённых» — общие для обеих вкладок, клиентские и только на
// время экрана: уход с «Сохранённых» их сбрасывает (`resetSavedFilters`).
// В Zustand, а не в состоянии экрана: лист фильтров живёт в своём окне, а
// отправка заметки (`notesOutbox`) проверяет, видна ли новая заметка.

import { create } from 'zustand';

import type { SavedCategory, SavedTypeFilter } from '@/api/saved';
import { NO_FILTERS, type SavedFilters } from '@/features/saved/savedFilters';

export const useSavedFiltersStore = create<SavedFilters>(() => NO_FILTERS);

export function useSavedFilters(): SavedFilters {
  return useSavedFiltersStore((state) => state);
}

export function getSavedFilters(): SavedFilters {
  return useSavedFiltersStore.getState();
}

function toggled<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function toggleFilterTag(tagId: string) {
  useSavedFiltersStore.setState((state) => ({ tags: toggled(state.tags, tagId) }));
}

/** Тап по тегу на пузыре: уже выбран — ничего не меняется. */
export function addFilterTag(tagId: string) {
  useSavedFiltersStore.setState((state) =>
    state.tags.includes(tagId) ? state : { tags: [...state.tags, tagId] },
  );
}

export function toggleFilterCategory(category: SavedCategory) {
  useSavedFiltersStore.setState((state) => ({ categories: toggled(state.categories, category) }));
}

export function toggleFilterType(type: SavedTypeFilter) {
  useSavedFiltersStore.setState((state) => ({ types: toggled(state.types, type) }));
}

/** «От» позже «до» не бывает: лист такую дату не даёт выбрать. */
export function setFilterDates(dates: Pick<SavedFilters, 'from' | 'to'>) {
  useSavedFiltersStore.setState(dates);
}

export function resetSavedFilters() {
  useSavedFiltersStore.setState(NO_FILTERS, true);
}
