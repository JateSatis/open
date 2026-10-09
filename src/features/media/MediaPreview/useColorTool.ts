// Мутация `.value` у shared value — штатный способ пользоваться Reanimated.
/* eslint-disable react-hooks/immutability */
import { useCallback, useMemo, useRef, useState } from 'react';
import { cancelAnimation, useSharedValue, withTiming } from 'react-native-reanimated';

import { commitPhotoEdit } from './commitEdit';
import type { LiveAdjust } from './EditedPhoto';
import { workingCopyOf } from './workingCopy';

import type { MediaLibraryItem } from '@/features/media/mediaLibrary';
import { photoEditOf } from '@/features/media/photoEdits/editsStore';
import { EMPTY_EDIT, type ColorAdjust } from '@/features/media/photoEdits/types';

/** Панель инструмента сменяет нижнюю панель плавно, фото ужимается за то же время. */
export const TOOL_SWITCH_MS = 260;
/** «Сбросить» возвращает ползунки к нулю не рывком. */
const RESET_MS = 250;

export type ColorToolState = {
  /** Открыт ли инструмент — для React: что рисовать и что принимает касания. */
  open: boolean;
  /** 0 — нижняя панель, 1 — панель инструмента; на UI-потоке. */
  progress: ReturnType<typeof useSharedValue<number>>;
  live: LiveAdjust;
  start: (asset: MediaLibraryItem) => void;
  /** Плавно вернуть все ползунки к нулю. */
  reset: () => void;
  cancel: () => void;
  done: () => void;
};

/**
 * Заход в «Настройку цвета» для одного фото: ползунки стартуют с его
 * текущей правки, крестик возвращает их к значениям на входе, галочка
 * применяет (`commitPhotoEdit`).
 */
export function useColorTool(): ColorToolState {
  const [open, setOpen] = useState(false);
  const progress = useSharedValue(0);
  const exposure = useSharedValue(0);
  const contrast = useSharedValue(0);
  const saturation = useSharedValue(0);
  const original = useSharedValue(0);
  const entry = useRef<{ asset: MediaLibraryItem; adjust: ColorAdjust } | null>(null);
  const resetAt = useRef(-Infinity);

  const live = useMemo<LiveAdjust>(
    () => ({ exposure, contrast, saturation, original }),
    [contrast, exposure, original, saturation],
  );

  const start = useCallback(
    (asset: MediaLibraryItem) => {
      const adjust = (photoEditOf(asset.id) ?? EMPTY_EDIT).adjust;

      entry.current = { asset, adjust };
      exposure.value = adjust.exposure;
      contrast.value = adjust.contrast;
      saturation.value = adjust.saturation;
      original.value = 0;
      setOpen(true);
      progress.value = withTiming(1, { duration: TOOL_SWITCH_MS });
      // Рабочая копия нужна и показу, и запеканию — пусть готовится сразу.
      void workingCopyOf(asset.id).catch(() => undefined);
    },
    [contrast, exposure, original, progress, saturation],
  );

  const reset = useCallback(() => {
    resetAt.current = performance.now();

    for (const value of [exposure, contrast, saturation]) {
      value.value = withTiming(0, { duration: RESET_MS });
    }
  }, [contrast, exposure, saturation]);

  const leave = useCallback(() => {
    original.value = 0;
    progress.value = withTiming(0, { duration: TOOL_SWITCH_MS });
    setOpen(false);
  }, [original, progress]);

  const cancel = useCallback(() => {
    const before = entry.current?.adjust;

    if (before) {
      exposure.value = before.exposure;
      contrast.value = before.contrast;
      saturation.value = before.saturation;
    }

    entry.current = null;
    leave();
  }, [contrast, exposure, leave, saturation]);

  const done = useCallback(() => {
    const current = entry.current;

    entry.current = null;
    leave();

    if (!current) return;

    const { asset } = current;

    // «Сбросить» мог ещё вести ползунки к нулю — сохраняется то, куда они едут.
    const resetting = performance.now() - resetAt.current < RESET_MS;

    for (const value of [exposure, contrast, saturation]) {
      cancelAnimation(value);
      if (resetting) value.value = 0;
    }

    // Обрезка и всё прочее, что у фото уже есть, остаётся как было.
    commitPhotoEdit(asset, {
      ...(photoEditOf(asset.id) ?? EMPTY_EDIT),
      adjust: {
        exposure: Math.round(exposure.value),
        contrast: Math.round(contrast.value),
        saturation: Math.round(saturation.value),
      },
    });
  }, [contrast, exposure, leave, saturation]);

  return { open, progress, live, start, reset, cancel, done };
}
