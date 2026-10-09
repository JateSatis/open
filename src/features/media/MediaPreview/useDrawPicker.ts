// Мутация `.value` у shared value — штатный способ пользоваться Reanimated.
/* eslint-disable react-hooks/immutability */
import type { SkImage } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import type { DrawingLayers } from './drawingLayers';
import { visibleImageOf } from './eyedropperPixels';
import { TOOL_SWITCH_MS } from './useColorTool';

import { setDrawBrushColor, useDrawSettings } from '@/features/media/drawSettings';
import { inkAlpha, inkOf, isColorBrush } from '@/features/media/photoEdits/drawing';
import type { ColorAdjust } from '@/features/media/photoEdits/types';

/** Что сейчас поверх рисования: ничего, панель цвета или пипетка. */
export type DrawPickerMode = 'none' | 'colors' | 'eyedropper';

/** Откуда пипетка берёт пиксели — то, что сейчас видно на фото. */
export type PickerSource = { image: SkImage; adjust: ColorAdjust; layers: DrawingLayers };

export type DrawPicker = {
  mode: DrawPickerMode;
  /** 0 — ряды кистей и кнопок, 1 — панель цвета; на UI-потоке. */
  progress: SharedValue<number>;
  /** Панель цвета открыта — касание фото её закроет; для жеста на UI-потоке. */
  colorsOpen: SharedValue<boolean>;
  /** Прозрачность с ползунка, 0…1. */
  alpha: SharedValue<number>;
  /** Видимое фото для пипетки; есть, пока она открыта. */
  sample: SkImage | null;
  openColors: () => void;
  close: () => void;
  /** Цвет `#rrggbb` — текущей кисти, с прозрачностью ползунка; панель закрывается. */
  pick: (rgb: string) => void;
  startEyedropper: () => void;
};

/** Через столько освободить картинку пипетки: UI-поток мог ещё рисовать её кадр. */
const RETIRE_SAMPLE_MS = 1000;

/**
 * Панель цвета и пипетка рисования. Цвет и прозрачность — свои у пера,
 * стрелки и маркера и запоминаются вместе с остальными настройками кистей.
 * Ползунок прозрачности сам цвет не меняет: применяет тап по цвету или
 * пипетка, «назад» и тап мимо панели оставляют цвет прежним.
 */
export function useDrawPicker(
  selectedColor: SharedValue<string>,
  source: () => PickerSource | null,
): DrawPicker {
  const [mode, setMode] = useState<DrawPickerMode>('none');
  const [sample, setSample] = useState<SkImage | null>(null);
  const sampleNow = useRef<SkImage | null>(null);
  const progress = useSharedValue(0);
  const colorsOpen = useSharedValue(false);
  const alpha = useSharedValue(1);

  const setSampleImage = useCallback((next: SkImage | null) => {
    const previous = sampleNow.current;

    sampleNow.current = next;
    setSample(next);
    if (previous && previous !== next) {
      setTimeout(() => previous.dispose(), RETIRE_SAMPLE_MS);
    }
  }, []);

  const close = useCallback(() => {
    setMode('none');
    colorsOpen.value = false;
    progress.value = withTiming(0, { duration: TOOL_SWITCH_MS });
    setSampleImage(null);
  }, [colorsOpen, progress, setSampleImage]);

  const openColors = useCallback(() => {
    const settings = useDrawSettings.getState();

    if (!isColorBrush(settings.brush)) return;

    void Haptics.selectionAsync();
    alpha.value = inkAlpha(settings.colors[settings.brush]);
    setMode('colors');
    colorsOpen.value = true;
    progress.value = withTiming(1, { duration: TOOL_SWITCH_MS });
  }, [alpha, colorsOpen, progress]);

  const pick = useCallback(
    (rgb: string) => {
      const { brush } = useDrawSettings.getState();

      if (isColorBrush(brush)) {
        const ink = inkOf(rgb, alpha.value);

        setDrawBrushColor(brush, ink);
        selectedColor.value = ink;
      }

      close();
    },
    [alpha, close, selectedColor],
  );

  const startEyedropper = useCallback(() => {
    const from = source();
    let image: SkImage | null = null;

    if (from) {
      try {
        image = visibleImageOf(from.image, from.adjust, from.layers);
      } catch (error) {
        console.warn('[photo-draw] картинка для пипетки не собралась', error);
      }
    }

    colorsOpen.value = false;
    progress.value = withTiming(0, { duration: TOOL_SWITCH_MS });

    if (!image) {
      setMode('none');
      return;
    }

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSampleImage(image);
    setMode('eyedropper');
  }, [colorsOpen, progress, setSampleImage, source]);

  return useMemo(
    () => ({
      mode,
      progress,
      colorsOpen,
      alpha,
      sample,
      openColors,
      close,
      pick,
      startEyedropper,
    }),
    [alpha, close, colorsOpen, mode, openColors, pick, progress, sample, startEyedropper],
  );
}
