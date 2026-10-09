// Мутация `.value` у shared value — штатный способ пользоваться Reanimated.
/* eslint-disable react-hooks/immutability */
import { useCallback, useMemo, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';
import { useSharedValue, withTiming } from 'react-native-reanimated';

import { bakePhoto } from './bake';
import type { LiveAdjust } from './EditedPhoto';
import { workingCopyOf } from './workingCopy';

import type { MediaLibraryItem } from '@/features/media/mediaLibrary';
import { photoEditOf, setPhotoEdit } from '@/features/media/photoEdits/editsStore';
import { EMPTY_EDIT, isNeutralAdjust, type ColorAdjust } from '@/features/media/photoEdits/types';
import { useMediaSelection } from '@/features/media/selectionStore';

/** Панель инструмента сменяет нижнюю панель плавно, фото ужимается за то же время. */
export const TOOL_SWITCH_MS = 260;

export type ColorToolState = {
  /** Открыт ли инструмент — для React: что рисовать и что принимает касания. */
  open: boolean;
  /** 0 — нижняя панель, 1 — панель инструмента; на UI-потоке. */
  progress: ReturnType<typeof useSharedValue<number>>;
  live: LiveAdjust;
  start: (asset: MediaLibraryItem) => void;
  cancel: () => void;
  done: () => void;
};

/**
 * Заход в «Настройку цвета» для одного фото: ползунки стартуют с его
 * текущей правки, крестик возвращает их к значениям на входе, галочка
 * записывает правку, запускает запекание и выбирает фото, если оно ещё не
 * выбрано и лимит позволяет.
 */
export function useColorTool(): ColorToolState {
  const [open, setOpen] = useState(false);
  const progress = useSharedValue(0);
  const exposure = useSharedValue(0);
  const contrast = useSharedValue(0);
  const saturation = useSharedValue(0);
  const original = useSharedValue(0);
  const entry = useRef<{ asset: MediaLibraryItem; adjust: ColorAdjust } | null>(null);

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
    const edit = {
      adjust: {
        exposure: Math.round(exposure.value),
        contrast: Math.round(contrast.value),
        saturation: Math.round(saturation.value),
      },
    };

    if (isNeutralAdjust(edit.adjust)) {
      setPhotoEdit(asset.id, edit, null);
      return;
    }

    const baked = bakePhoto(asset.id, edit);

    setPhotoEdit(asset.id, edit, baked);
    // Запекание — после анимации смены панели: оно занимает JS-поток.
    // Рабочая копия к этому времени давно готова: она готовится, как только
    // фото стало текущим в предпросмотре.
    void workingCopyOf(asset.id)
      .then(() =>
        InteractionManager.runAfterInteractions(() => {
          try {
            baked.file();
          } catch {
            // Отправка допечёт заново и при сбое упадёт с «повторить».
          }
        }),
      )
      .catch(() => undefined);

    const selection = useMediaSelection.getState();

    // Правка — намерение отправить это фото.
    if (!selection.order.includes(asset.id) && selection.order.length < selection.limit) {
      selection.toggle(asset);
    }
  }, [contrast, exposure, leave, saturation]);

  return { open, progress, live, start, cancel, done };
}
