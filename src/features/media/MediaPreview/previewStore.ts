import { create } from 'zustand';

import type { MediaLibraryItem } from '@/features/media/mediaLibrary';
import { createTileRegistry, type Rect } from '@/features/media/tileRegistry';

export type { Rect };

type PreviewState = {
  /** Открытый предпросмотр: с какого файла и из какой плитки он вылетел. */
  target: { assetId: string; origin: Rect | null } | null;
  /** Галерея в порядке сетки — её же листает предпросмотр. */
  gallery: MediaLibraryItem[];
};

/**
 * Предпросмотр файлов шита медиа. Открывает его клетка сетки, а живёт он в
 * окне шита; стор между ними — чтобы клетка не получала ни пропов, ни
 * подписок ради этого (см. `MediaGridItem`).
 */
export const useMediaPreview = create<PreviewState>(() => ({ target: null, gallery: [] }));

export function openMediaPreview(asset: MediaLibraryItem, origin: Rect | null) {
  useMediaPreview.setState({ target: { assetId: asset.id, origin } });
}

/** Предпросмотр ушёл — уже после анимации возврата. */
export function closeMediaPreview() {
  if (useMediaPreview.getState().target) useMediaPreview.setState({ target: null });
}

export function useMediaPreviewOpen(): boolean {
  return useMediaPreview((state) => state.target !== null);
}

/** Сетка отдаёт свежий список галереи: он дочитывается, пока шит открыт. */
export function publishPreviewGallery(gallery: MediaLibraryItem[]) {
  if (useMediaPreview.getState().gallery !== gallery) useMediaPreview.setState({ gallery });
}

/**
 * Клетки сетки по id файла: при выходе файл улетает в свою плитку. Клетка
 * пишет в таблицу ссылку на свою вью — ни пропов, ни подписок.
 */
const cells = createTileRegistry();

export const registerGridCell = cells.register;

/** Клетка разобрана или переиспользована под другой файл — её запись больше не её. */
export const unregisterGridCell = cells.unregister;

/** Где сейчас клетка файла; `null` — её нет среди смонтированных. */
export const measureGridCell = cells.measure;

/**
 * «Назад» окна шита: открытый предпросмотр отвечает на него сам (закрывает
 * инструмент или себя), шит под ним остаётся.
 */
let backHandler: (() => void) | null = null;

export function setPreviewBackHandler(handler: (() => void) | null) {
  backHandler = handler;
}

export function handlePreviewBack(): boolean {
  if (!useMediaPreview.getState().target || !backHandler) return false;

  backHandler();

  return true;
}

/** Окно шита разобрано — предпросмотр уходит вместе с ним. */
export function resetMediaPreview() {
  backHandler = null;
  useMediaPreview.setState({ target: null });
}
