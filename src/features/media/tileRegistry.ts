import { createContext, useContext } from 'react';
import type { View } from 'react-native';
import { create } from 'zustand';

/** Прямоугольник в координатах окна: у всех окон приложения они от верха экрана. */
export type Rect = { x: number; y: number; width: number; height: number };

/** Скругление углов плитки — у тех, что совпадают с углами облачка. */
export type Corners = { topLeft: number; topRight: number; bottomLeft: number; bottomRight: number };

/** Плитка на экране: место и скругление, в которое уходит и из которого растёт медиа. */
export type TileRect = Rect & { corners?: Corners };

/**
 * Плитки, из которых открывают медиа: при выходе медиа улетает в плитку
 * текущего файла, и её место нужно знать. Это обычная таблица, не подписка:
 * плитка пишет в неё ссылку на свою вью, и только. Список переиспользует
 * вью под другие файлы — запись снимается сверкой вью, а не по одному id.
 */
export type TileRegistry = {
  register: (id: string, view: View | null, corners?: Corners) => void;
  unregister: (id: string, view: View | null) => void;
  /** Где сейчас плитка файла; `null` — её нет среди смонтированных. */
  measure: (id: string) => Promise<TileRect | null>;
};

export function createTileRegistry(): TileRegistry {
  const tiles = new Map<string, { view: View; corners?: Corners }>();

  return {
    register(id, view, corners) {
      if (view) tiles.set(id, { view, corners });
      else tiles.delete(id);
    },
    unregister(id, view) {
      if (tiles.get(id)?.view === view) tiles.delete(id);
    },
    async measure(id) {
      const tile = tiles.get(id);
      const rect = await measureView(tile?.view ?? null);

      return rect && tile?.corners ? { ...rect, corners: tile.corners } : rect;
    },
  };
}

/** Отсоединённая вью на замер не отвечает вовсе — дольше не ждём. */
const MEASURE_WAIT_MS = 300;

export function measureView(view: View | null): Promise<Rect | null> {
  if (!view?.measureInWindow) return Promise.resolve(null);

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), MEASURE_WAIT_MS);

    view.measureInWindow((x, y, width, height) => {
      clearTimeout(timer);
      resolve(width > 0 && height > 0 ? { x, y, width, height } : null);
    });
  });
}

/**
 * Где на экране видна прокручиваемая область с плитками: медиа улетает в
 * плитку, только если её центр внутри — иначе оно уходило бы под шапку или
 * поле ввода. Без области — весь экран.
 */
export const TileViewportContext = createContext<(() => Promise<Rect | null>) | null>(null);

export function useTileViewport(): (() => Promise<Rect | null>) | null {
  return useContext(TileViewportContext);
}

/** Видна ли плитка: её центр внутри области. */
export function tileVisible<T extends Rect>(tile: T | null, viewport: Rect | null): tile is T {
  if (!tile) return false;
  if (!viewport) return true;

  const centerX = tile.x + tile.width / 2;
  const centerY = tile.y + tile.height / 2;

  return (
    centerX > viewport.x &&
    centerX < viewport.x + viewport.width &&
    centerY > viewport.y &&
    centerY < viewport.y + viewport.height
  );
}

/**
 * Плитка, медиа которой сейчас открыто поверх неё: она прячется, чтобы не
 * двоиться с летящей копией. Одна на приложение — просмотр открыт один.
 */
const useHiddenTileStore = create<{ id: string | null }>(() => ({ id: null }));

export function setHiddenTile(id: string | null) {
  if (useHiddenTileStore.getState().id !== id) useHiddenTileStore.setState({ id });
}

/** Спрятана ли плитка `id`: подписка одним булевым, перерисуется только своя плитка. */
export function useTileHidden(id: string): boolean {
  return useHiddenTileStore((state) => state.id === id);
}
