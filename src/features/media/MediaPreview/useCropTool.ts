// Мутация `.value` у shared value — штатный способ пользоваться Reanimated.
/* eslint-disable react-hooks/immutability */
import type { SkImage } from '@shopify/react-native-skia';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  cancelAnimation,
  Easing,
  runOnJS,
  runOnUI,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { commitPhotoEdit } from './commitEdit';
import {
  centerSquare,
  currentCrop,
  fittedFrame,
  isRecentering,
  NO_TWIST,
  recenteringFrame,
  twistBetween,
  type CropMotion,
  type CropTwist,
} from './cropMotion';
import { safeDrawingLayersOf, type DrawingLayers } from './drawingLayers';
import { TOOL_SWITCH_MS } from './useColorTool';
import { workingCopyOf, workingImageOf } from './workingCopy';

import type { MediaLibraryItem } from '@/features/media/mediaLibrary';
import {
  alignCrop,
  coverCrop,
  defaultCrop,
  mirrorCrop,
  rotateQuarter,
  squareCrop,
  type Box,
  type PhotoCrop,
} from '@/features/media/photoEdits/crop';
import { photoEditOf } from '@/features/media/photoEdits/editsStore';
import { EMPTY_EDIT, type ColorAdjust } from '@/features/media/photoEdits/types';

/** Разворот, отражение, сброс — за столько. */
export const CROP_TURN_MS = 280;
const TURN_EASING = Easing.out(Easing.cubic);

/** Фото, открытое в обрезке: что рисовать. */
export type CropSession = {
  asset: MediaLibraryItem;
  image: SkImage;
  /** Цвет фото — в обрезке он виден, но не меняется. */
  adjust: ColorAdjust;
  /** Рисунок фото — вертится и режется вместе с ним. */
  layers: DrawingLayers;
};

export type CropToolState = {
  /** Открыт ли инструмент — для React: какая панель внизу и что принимает касания. */
  open: boolean;
  /** Фото в обрезке: рисуется, пока открыта и пока идёт выход. */
  session: CropSession | null;
  motion: CropMotion;
  /** 1 — обрезка рисует фото сама, страница спрятана. */
  cover: SharedValue<number>;
  /**
   * Опора для линейки: обрезка до поворота. Поворот считается от неё, и
   * вернул угол — вернулось увеличение. Любая другая правка её сбрасывает.
   */
  rotationBase: SharedValue<PhotoCrop | null>;
  start: (asset: MediaLibraryItem) => void;
  /** Слой обрезки нарисовал первый кадр — можно прятать страницу и входить. */
  ready: () => void;
  rotate: () => void;
  mirror: () => void;
  reset: () => void;
  cancel: () => void;
  done: () => void;
};

/**
 * Переход к другой обрезке: разворот и отражение — жёстко, вместе с рамкой,
 * остальное (угол, центр, размер) — плавно. Первый кадр перехода совпадает с
 * тем, что на экране сейчас; если разворот ещё не догас, его остаток
 * отбрасывается.
 */
export function startCropTransition(
  m: CropMotion,
  next: PhotoCrop,
  options: { cover: boolean; duration: number; delay?: number },
) {
  'worklet';
  const now = currentCrop(m);
  let before: Box = m.frame.value ?? fittedFrame(now, m.area.value);

  if (isRecentering(m)) before = recenteringFrame(m, before);

  cancelAnimation(m.t);

  const aligned = alignCrop(now, next);
  const alignedFrame = fittedFrame(aligned.from, m.area.value);

  m.from.value = aligned.from;
  m.crop.value = next;
  m.frame.value = null;
  m.covering.value = options.cover;
  m.twist.value = twistBetween(before, alignedFrame, aligned.rotation, aligned.mirror);
  m.t.value = 0;

  const timing = withTiming(1, { duration: options.duration, easing: TURN_EASING });

  m.t.value = options.delay ? withDelay(options.delay, timing) : timing;
}

/**
 * Заход в «Обрезку и поворот» для одного фото. Стартует с его текущей
 * обрезки; крестик возвращает её к состоянию на входе без вопроса, галочка
 * применяет (`commitPhotoEdit`).
 *
 * `square` — обрезка аватарки: рамка всегда квадратная, без обрезки на входе
 * — наибольший квадрат по центру (он и стал бы аватаркой).
 */
export function useCropTool(square = false): CropToolState {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<CropSession | null>(null);
  const entry = useRef<{ asset: MediaLibraryItem; crop: PhotoCrop } | null>(null);
  const starting = useRef(false);
  /** Слой ещё гаснет после прошлого захода — новый заход подождёт его. */
  const closing = useRef(false);

  const plain = defaultCrop(1);
  const crop = useSharedValue<PhotoCrop>(plain);
  const from = useSharedValue<PhotoCrop>(plain);
  const twist = useSharedValue<CropTwist>(NO_TWIST);
  const t = useSharedValue(1);
  const covering = useSharedValue(true);
  const frame = useSharedValue<Box | null>(null);
  const area = useSharedValue<Box>({ x: 0, y: 0, width: 1, height: 1 });
  const screen = useSharedValue<Box>({ x: 0, y: 0, width: 1, height: 1 });
  const enter = useSharedValue(0);
  const grid = useSharedValue(0);
  const cover = useSharedValue(0);
  const rotationBase = useSharedValue<PhotoCrop | null>(null);
  const page = useSharedValue<Box | null>(null);

  const motion = useMemo<CropMotion>(
    () => ({ crop, from, twist, t, covering, frame, area, screen, enter, grid, square, page }),
    [area, covering, crop, enter, frame, from, grid, page, screen, square, t, twist],
  );

  const start = useCallback(
    (asset: MediaLibraryItem) => {
      if (starting.current || entry.current || closing.current) return;

      starting.current = true;
      // Рабочая копия обычно уже готова: она готовится, как только фото
      // задержалось на экране.
      void workingCopyOf(asset.id)
        .then((copy) => {
          const edit = photoEditOf(asset.id) ?? EMPTY_EDIT;
          const ratio = copy.sourceHeight / copy.sourceWidth;
          const initial = edit.crop ?? (square ? squareCrop(ratio) : defaultCrop(ratio));
          // Страница аватарки без обрезки показывает фото целиком: рамка
          // входит из его центрального квадрата и туда же уходит по «Отмене».
          const whole = square && edit.crop === undefined;

          entry.current = { asset, crop: initial };
          // Одним ворклетом: кнопки и жесты читают обрезку на UI-потоке,
          // и запись по частям с JS-потока туда могла бы прийти не сразу.
          runOnUI(() => {
            'worklet';
            cancelAnimation(t);
            crop.value = initial;
            from.value = initial;
            twist.value = NO_TWIST;
            t.value = 1;
            frame.value = null;
            enter.value = 0;
            grid.value = 0;
            rotationBase.value = null;
            page.value = whole ? centerSquare(1 / ratio, screen.value) : null;
          })();
          const image = workingImageOf(asset.id, copy);

          setSession({
            asset,
            image,
            adjust: edit.adjust,
            layers: safeDrawingLayersOf(asset.id, image, edit.drawing),
          });
          setOpen(true);
        })
        .catch(() => undefined)
        .finally(() => {
          starting.current = false;
        });
    },
    [crop, enter, frame, from, grid, page, rotationBase, screen, square, t, twist],
  );

  const ready = useCallback(() => {
    // Первый кадр пришёл, когда инструмент уже закрыли, — входить некуда.
    if (!entry.current) return;

    cover.value = 1;
    enter.value = withTiming(1, { duration: TOOL_SWITCH_MS });
  }, [cover, enter]);

  const turn = useCallback(
    (change: (crop: PhotoCrop) => PhotoCrop) => {
      runOnUI(() => {
        'worklet';
        rotationBase.value = null;
        startCropTransition(motion, change(crop.value), { cover: true, duration: CROP_TURN_MS });
      })();
    },
    [crop, motion, rotationBase],
  );

  const rotate = useCallback(() => turn(rotateQuarter), [turn]);
  const mirror = useCallback(() => turn(mirrorCrop), [turn]);
  const reset = useCallback(
    () =>
      turn((now) => {
        'worklet';
        return square ? squareCrop(now.sourceRatio) : defaultCrop(now.sourceRatio);
      }),
    [square, turn],
  );

  const closed = useCallback(() => {
    closing.current = false;
    setSession(null);
  }, []);

  const leave = useCallback(() => {
    entry.current = null;
    closing.current = true;
    setOpen(false);
    enter.value = withTiming(0, { duration: TOOL_SWITCH_MS }, (finished) => {
      if (!finished) return;

      cover.value = 0;
      runOnJS(closed)();
    });
  }, [closed, cover, enter]);

  const cancel = useCallback(() => {
    const before = entry.current;

    if (before) {
      runOnUI(() => {
        'worklet';
        startCropTransition(motion, before.crop, { cover: true, duration: TOOL_SWITCH_MS });
      })();
    }

    leave();
  }, [leave, motion]);

  const done = useCallback(() => {
    const current = entry.current;

    if (!current) return;

    // Переход мог ещё идти — применяется то, куда он ведёт. Палец мог
    // ещё тянуть фото за край — применяется то, куда оно спружинит.
    const result = coverCrop(crop.value);

    // Страница теперь покажет обрезку — рамка уходит в неё, а не в квадрат целого фото.
    page.value = null;
    leave();
    commitPhotoEdit(current.asset, {
      ...(photoEditOf(current.asset.id) ?? EMPTY_EDIT),
      crop: result,
    });
  }, [crop, leave, page]);

  return {
    open,
    session,
    motion,
    cover,
    rotationBase,
    start,
    ready,
    rotate,
    mirror,
    reset,
    cancel,
    done,
  };
}
