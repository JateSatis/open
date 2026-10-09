import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { sizeRange } from '@/features/media/sizeSlider';
import {
  DRAW_BRUSHES,
  isColorBrush,
  normalizeInk,
  type ColorBrush,
  type DrawBrush,
} from '@/features/media/photoEdits/drawing';

/**
 * Кисти рисования, как их оставил человек: выбранная кисть, толщина каждой
 * и цвет кистей с цветом. Запоминается на телефоне и восстанавливается при
 * следующем рисовании, и после перезапуска тоже.
 *
 * Толщина — в точках экрана: какой кружок на ползунке, такой и штрих под
 * пальцем при текущем увеличении (в единицы фото её переводит инструмент в
 * начале штриха).
 */
export type DrawSettings = {
  brush: DrawBrush;
  sizes: Record<DrawBrush, number>;
  /** Цвет с прозрачностью, `#rrggbbaa`. */
  colors: Record<ColorBrush, string>;
};

/** Цвет по умолчанию — красный, непрозрачный. */
export const DEFAULT_DRAW_COLOR = '#ff3b30ff';

/**
 * Пределы толщины, точки экрана, — одни для всех кистей: бегунок
 * ползунка — кружок той же толщины, и он целиком влезает в шкалу-клин.
 * Шире клина линии не бывает. Положение бегунка ↔ толщина — `sizeSlider.ts`.
 */
export const DRAW_SIZE_RANGE = sizeRange();

export const DEFAULT_DRAW_SETTINGS: DrawSettings = {
  brush: 'pen',
  sizes: { pen: 6, arrow: 6, marker: 14, blur: 17, eraser: 16 },
  colors: { pen: DEFAULT_DRAW_COLOR, arrow: DEFAULT_DRAW_COLOR, marker: DEFAULT_DRAW_COLOR },
};

// Ключ прежний: цвета без прозрачности, сохранённые до неё, читаются как непрозрачные.
const STORAGE_KEY = 'media.drawSettings.v1';

export const useDrawSettings = create<DrawSettings>(() => DEFAULT_DRAW_SETTINGS);

function clampSize(brush: DrawBrush, value: unknown): number {
  const { min, max } = DRAW_SIZE_RANGE;

  if (typeof value !== 'number' || !Number.isFinite(value))
    return DEFAULT_DRAW_SETTINGS.sizes[brush];

  return Math.min(max, Math.max(min, value));
}

/** Сохранённое — с проверкой: файл мог остаться от старой версии или побиться. */
export function parseDrawSettings(raw: string | null): DrawSettings {
  if (!raw) return DEFAULT_DRAW_SETTINGS;

  let data: unknown;

  try {
    data = JSON.parse(raw);
  } catch {
    return DEFAULT_DRAW_SETTINGS;
  }

  if (typeof data !== 'object' || data === null) return DEFAULT_DRAW_SETTINGS;

  const stored = data as Partial<Record<keyof DrawSettings, unknown>>;
  const sizes = (
    typeof stored.sizes === 'object' && stored.sizes !== null ? stored.sizes : {}
  ) as Record<string, unknown>;
  const colors = (
    typeof stored.colors === 'object' && stored.colors !== null ? stored.colors : {}
  ) as Record<string, unknown>;
  const brush = DRAW_BRUSHES.find((known) => known === stored.brush) ?? DEFAULT_DRAW_SETTINGS.brush;
  const color = (key: ColorBrush) => normalizeInk(colors[key]) ?? DEFAULT_DRAW_SETTINGS.colors[key];

  return {
    brush,
    sizes: {
      pen: clampSize('pen', sizes.pen),
      arrow: clampSize('arrow', sizes.arrow),
      marker: clampSize('marker', sizes.marker),
      blur: clampSize('blur', sizes.blur),
      eraser: clampSize('eraser', sizes.eraser),
    },
    colors: { pen: color('pen'), arrow: color('arrow'), marker: color('marker') },
  };
}

let loading: Promise<void> | null = null;
/** Человек успел поменять кисть до того, как прочиталось сохранённое, — его выбор важнее. */
let touched = false;

/** Прочитать сохранённые кисти — один раз за запуск. */
export function loadDrawSettings(): Promise<void> {
  if (!loading) {
    loading = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!touched) useDrawSettings.setState(parseDrawSettings(raw));
      })
      .catch(() => undefined);
  }

  return loading;
}

function save(next: DrawSettings) {
  touched = true;
  useDrawSettings.setState(next);
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
}

export function selectDrawBrush(brush: DrawBrush) {
  const settings = useDrawSettings.getState();

  if (settings.brush !== brush) save({ ...settings, brush });
}

export function setDrawBrushSize(brush: DrawBrush, size: number) {
  const settings = useDrawSettings.getState();
  const value = clampSize(brush, size);

  if (settings.sizes[brush] !== value) {
    save({ ...settings, sizes: { ...settings.sizes, [brush]: value } });
  }
}

export function setDrawBrushColor(brush: ColorBrush, color: string) {
  const settings = useDrawSettings.getState();
  const value = normalizeInk(color);

  if (value && settings.colors[brush] !== value) {
    save({ ...settings, colors: { ...settings.colors, [brush]: value } });
  }
}

/** Цвет кисти; у размытия и ластика цвета нет. */
export function drawColorOf(settings: DrawSettings, brush: DrawBrush): string | null {
  return isColorBrush(brush) ? settings.colors[brush] : null;
}
