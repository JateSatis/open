import type { View } from 'react-native';
import { create } from 'zustand';

import type { MediaLibraryItem } from '@/features/media/mediaLibrary';

/** Прямоугольник в координатах окна шита. */
export type Rect = { x: number; y: number; width: number; height: number };

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
 * Клетки сетки по id файла: при выходе файл улетает в свою плитку, и её
 * место нужно знать. Это обычная таблица, не подписка: клетка пишет в неё
 * ссылку на свою вью, и только.
 */
const cells = new Map<string, View>();

export function registerGridCell(id: string, view: View | null) {
  if (view) cells.set(id, view);
  else cells.delete(id);
}

/** Клетка разобрана или переиспользована под другой файл — её запись больше не её. */
export function unregisterGridCell(id: string, view: View | null) {
  if (cells.get(id) === view) cells.delete(id);
}

/** Где сейчас клетка файла; `null` — её нет среди смонтированных. */
export function measureGridCell(id: string): Promise<Rect | null> {
  const view = cells.get(id);

  if (!view) return Promise.resolve(null);

  return new Promise((resolve) => {
    view.measureInWindow((x, y, width, height) =>
      resolve(width > 0 ? { x, y, width, height } : null),
    );
  });
}

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
