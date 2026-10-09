// Мутация `.value` у shared value — штатный способ пользоваться Reanimated.
/* eslint-disable react-hooks/immutability */
import type { SkImage } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  cancelAnimation,
  runOnJS,
  runOnUI,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { commitPhotoEdit } from './commitEdit';
import {
  appendDrawingStroke,
  blurredCopyOf,
  blurredLinesOf,
  NO_LAYERS,
  rememberDrawingLayers,
  renderDrawingLayers,
  retireDrawingLayers,
  safeDrawingLayersOf,
  type DrawingLayers,
} from './drawingLayers';
import { TOOL_SWITCH_MS } from './useColorTool';
import { workingCopyOf, workingImageOf } from './workingCopy';

import { confirm } from '@/components/ConfirmDialog';
import {
  drawColorOf,
  loadDrawSettings,
  selectDrawBrush,
  setDrawBrushSize,
  useDrawSettings,
} from '@/features/media/drawSettings';
import type { MediaLibraryItem } from '@/features/media/mediaLibrary';
import { defaultCrop, type PhotoCrop } from '@/features/media/photoEdits/crop';
import {
  normalizeDrawing,
  type DrawBrush,
  type DrawStroke,
  type PhotoDrawing,
} from '@/features/media/photoEdits/drawing';
import { photoEditOf } from '@/features/media/photoEdits/editsStore';
import { EMPTY_EDIT } from '@/features/media/photoEdits/types';

/** Увеличение в рисовании — в точках холста страницы, поверх обрезки. */
export type DrawZoom = {
  scale: SharedValue<number>;
  x: SharedValue<number>;
  y: SharedValue<number>;
};

/** Всё, что живой показ берёт у открытого рисования, — на UI-потоке. */
export type LiveDraw = {
  layers: SharedValue<DrawingLayers>;
  /** Штрих под пальцем: x0, y0, x1, y1… в долях ширины исходника; пусто — не рисуют. */
  points: SharedValue<number[]>;
  /** Кисть и цвет штриха под пальцем — какими они были, когда палец коснулся. */
  brush: SharedValue<DrawBrush>;
  color: SharedValue<string>;
  /** Толщина штриха под пальцем — в долях ширины исходника. */
  width: SharedValue<number>;
  zoom: DrawZoom;
  /** Размытая копия фото — её кладёт мазок размытия под пальцем. */
  blurred: SkImage | null;
  /** Размытая копия нарисованного — ею мазок размытия замазывает линии. */
  blurredLines: SkImage | null;
};

/** Фото, открытое в рисовании. */
export type DrawSession = {
  asset: MediaLibraryItem;
  image: SkImage;
  /** Обрезка фото: рисунок ложится под ней, жесты переводят экран в фото через неё. */
  crop: PhotoCrop;
};

export type DrawToolState = {
  /** Открыто ли рисование — для React: какая панель и что принимает касания. */
  open: boolean;
  /** Фото в рисовании: живёт, пока открыто и пока идёт выход. */
  session: DrawSession | null;
  /** 0 — нижняя панель, 1 — панель рисования; на UI-потоке. */
  progress: SharedValue<number>;
  live: LiveDraw;
  brush: DrawBrush;
  /** Выбранные кисть и её цвет — с них начинается следующий штрих. */
  selectedBrush: SharedValue<DrawBrush>;
  selectedColor: SharedValue<string>;
  /** Толщина выбранной кисти в точках экрана — её двигает ползунок. */
  size: SharedValue<number>;
  /** Номер штриха под пальцем: штрих, сменившийся другим, не стирает чужие точки. */
  strokeId: SharedValue<number>;
  /** Есть что отменять стрелкой. */
  canUndo: boolean;
  /** На фото что-то нарисовано — виден «Сбросить». */
  hasDrawing: boolean;
  /** В этом заходе что-то изменилось — крестик активен и спросит. */
  dirty: boolean;
  start: (asset: MediaLibraryItem) => void;
  selectBrush: (brush: DrawBrush) => void;
  /** Ползунок отпустили — толщина кисти запоминается. */
  commitSize: (size: number) => void;
  /** Палец отпущен: штрих ложится в рисунок. */
  finishStroke: (
    id: number,
    points: number[],
    brush: DrawBrush,
    color: string,
    width: number,
  ) => void;
  undo: () => void;
  reset: () => void;
  cancel: () => void;
  done: () => void;
};

type Session = DrawSession & {
  entry: PhotoDrawing;
  entryLayers: DrawingLayers;
};

/**
 * Заход в «Рисование» для одного фото. Начинается с текущего рисунка: его
 * можно продолжать, а стрелка отменяет и штрихи прошлых заходов.
 *
 * История — снимки рисунка: каждый штрих и «Сбросить» кладут в неё рисунок
 * до себя. Кончилась история захода — стрелка снимает последний штрих
 * рисунка, с которым вошли. Крестик возвращает рисунок на входе (с вопросом,
 * если есть что терять), галочка применяет (`commitPhotoEdit`).
 */
export function useDrawTool(): DrawToolState {
  const brushSetting = useDrawSettings((state) => state.brush);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<DrawSession | null>(null);
  const [blurred, setBlurred] = useState<SkImage | null>(null);
  const [blurredLines, setBlurredLines] = useState<SkImage | null>(null);
  const blurredLinesNow = useRef<SkImage | null>(null);
  const brushNow = useRef<DrawBrush>('pen');
  const [flags, setFlags] = useState({ canUndo: false, hasDrawing: false, dirty: false });

  const current = useRef<Session | null>(null);
  const strokes = useRef<PhotoDrawing>([]);
  const history = useRef<PhotoDrawing[]>([]);
  const layersNow = useRef<DrawingLayers>(NO_LAYERS);
  const starting = useRef(false);
  const closing = useRef(false);
  const asking = useRef(false);
  /** Номер последнего штриха, уже положенного в рисунок. */
  const finished = useRef(0);

  const progress = useSharedValue(0);
  const layers = useSharedValue<DrawingLayers>(NO_LAYERS);
  const points = useSharedValue<number[]>([]);
  const brush = useSharedValue<DrawBrush>('pen');
  const color = useSharedValue('#000000');
  const selectedBrush = useSharedValue<DrawBrush>('pen');
  const selectedColor = useSharedValue('#000000');
  const width = useSharedValue(0);
  const size = useSharedValue(0);
  const strokeId = useSharedValue(0);
  const scale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);

  const zoom = useMemo<DrawZoom>(() => ({ scale, x, y }), [scale, x, y]);
  const live = useMemo<LiveDraw>(
    () => ({ layers, points, brush, color, width, zoom, blurred, blurredLines }),
    [blurred, blurredLines, brush, color, layers, points, width, zoom],
  );

  /**
   * Размытая копия линий — только пока выбрано размытие, и свежая после
   * каждого шага: мазок под пальцем замазывает то, что нарисовано сейчас.
   */
  const refreshBlurredLines = useCallback((next: DrawBrush, lines: SkImage | null) => {
    const open = current.current;
    const previous = blurredLinesNow.current;
    let fresh: SkImage | null = null;

    if (next === 'blur' && open && lines) {
      try {
        fresh = blurredLinesOf(open.image, lines);
      } catch (error) {
        console.warn('[photo-draw] размытая копия линий не вышла', error);
      }
    }

    blurredLinesNow.current = fresh;
    setBlurredLines(fresh);
    // Прежнюю копию ещё может рисовать кадр UI-потока.
    if (previous) setTimeout(() => previous.dispose(), 1000);
  }, []);

  /** Размытая копия нужна, только пока выбрано размытие. */
  const prepareBlur = useCallback((next: DrawBrush) => {
    const open = current.current;

    if (next !== 'blur' || !open) return;

    try {
      setBlurred(blurredCopyOf(open.asset.id, open.image));
    } catch (error) {
      console.warn('[photo-draw] размытая копия не вышла', error);
    }
  }, []);

  const applyBrush = useCallback(
    (next: DrawBrush) => {
      const settings = useDrawSettings.getState();

      brushNow.current = next;
      selectedBrush.value = next;
      selectedColor.value = drawColorOf(settings, next) ?? '#000000';
      size.value = settings.sizes[next];
      prepareBlur(next);
      refreshBlurredLines(next, layersNow.current.lines);
    },
    [prepareBlur, refreshBlurredLines, selectedBrush, selectedColor, size],
  );

  /** Новый рисунок захода: слои — на экран, флаги — в панель. */
  const show = useCallback(
    (next: PhotoDrawing, nextLayers: DrawingLayers, clearId?: number) => {
      const open = current.current;

      const linesChanged = layersNow.current.lines !== nextLayers.lines;

      if (layersNow.current !== nextLayers) {
        retireDrawingLayers(layersNow.current, nextLayers, open ? [open.entryLayers] : []);
      }

      strokes.current = next;
      layersNow.current = nextLayers;
      if (linesChanged) refreshBlurredLines(brushNow.current, nextLayers.lines);
      // Одним ворклетом: готовый слой и снятый штрих под пальцем — в один кадр.
      runOnUI(() => {
        'worklet';
        layers.value = nextLayers;
        if (clearId !== undefined && strokeId.value === clearId) points.value = [];
      })();
      setFlags({
        canUndo: history.current.length > 0 || next.length > 0,
        hasDrawing: next.length > 0,
        dirty: open !== null && next !== open.entry,
      });
    },
    [layers, points, refreshBlurredLines, strokeId],
  );

  const start = useCallback(
    (asset: MediaLibraryItem) => {
      if (starting.current || current.current || closing.current) return;

      starting.current = true;
      void Promise.all([workingCopyOf(asset.id), loadDrawSettings()])
        .then(([copy]) => {
          const edit = photoEditOf(asset.id) ?? EMPTY_EDIT;
          const image = workingImageOf(asset.id, copy);
          const crop = edit.crop ?? defaultCrop(image.height() / image.width());
          const entry = edit.drawing ?? [];
          const entryLayers = safeDrawingLayersOf(asset.id, image, entry);

          current.current = { asset, image, crop, entry, entryLayers };
          history.current = [];
          layersNow.current = entryLayers;
          setSession({ asset, image, crop });
          setBlurred(null);
          applyBrush(useDrawSettings.getState().brush);
          show(entry, entryLayers);
          runOnUI(() => {
            'worklet';
            points.value = [];
            cancelAnimation(scale);
            cancelAnimation(x);
            cancelAnimation(y);
            scale.value = 1;
            x.value = 0;
            y.value = 0;
          })();
          setOpen(true);
          progress.value = withTiming(1, { duration: TOOL_SWITCH_MS });
        })
        .catch(() => undefined)
        .finally(() => {
          starting.current = false;
        });
    },
    [applyBrush, points, progress, scale, show, x, y],
  );

  const selectBrush = useCallback(
    (next: DrawBrush) => {
      void Haptics.selectionAsync();
      selectDrawBrush(next);
      applyBrush(next);
    },
    [applyBrush],
  );

  const commitSize = useCallback(
    (value: number) => setDrawBrushSize(useDrawSettings.getState().brush, value),
    [],
  );

  /**
   * Слои с новым штрихом. Не собрались (нет памяти под поверхность) —
   * штрих не ложится, история не трогается: рисовать можно дальше.
   */
  const addStroke = useCallback((stroke: DrawStroke): DrawingLayers | null => {
    const open = current.current;

    if (!open || stroke.points.length === 0) return null;

    try {
      const next = appendDrawingStroke(open.asset.id, open.image, layersNow.current, stroke);

      history.current.push(strokes.current);

      return next;
    } catch (error) {
      console.warn('[photo-draw] штрих не лёг', error);
      return null;
    }
  }, []);

  const finishStroke = useCallback(
    (
      id: number,
      strokePoints: number[],
      strokeBrush: DrawBrush,
      strokeColor: string,
      strokeWidth: number,
    ) => {
      const stroke = {
        brush: strokeBrush,
        color: strokeColor,
        width: strokeWidth,
        points: strokePoints,
      };
      const nextLayers = addStroke(stroke);

      finished.current = id;
      if (nextLayers) show([...strokes.current, stroke], nextLayers, id);
      else
        runOnUI(() => {
          'worklet';
          if (strokeId.value === id) points.value = [];
        })();
    },
    [addStroke, points, show, strokeId],
  );

  const restore = useCallback(
    (next: PhotoDrawing) => {
      const open = current.current;

      if (!open) return false;

      try {
        show(
          next,
          next === open.entry
            ? open.entryLayers
            : renderDrawingLayers(open.asset.id, open.image, next),
        );
      } catch (error) {
        console.warn('[photo-draw] отмена не собралась', error);
        return false;
      }

      return true;
    },
    [show],
  );

  const undo = useCallback(() => {
    const previous = history.current.at(-1);

    if (previous) {
      if (restore(previous)) history.current.pop();
    } else if (strokes.current.length > 0) {
      restore(strokes.current.slice(0, -1));
    }
  }, [restore]);

  const reset = useCallback(() => {
    if (strokes.current.length === 0) return;

    history.current.push(strokes.current);
    show([], NO_LAYERS);
  }, [show]);

  const closed = useCallback(() => {
    closing.current = false;
    setSession(null);
    setBlurred(null);
    refreshBlurredLines('pen', null);
  }, [refreshBlurredLines]);

  const leave = useCallback(() => {
    current.current = null;
    closing.current = true;
    setOpen(false);
    runOnUI(() => {
      'worklet';
      points.value = [];
      scale.value = withTiming(1, { duration: TOOL_SWITCH_MS });
      x.value = withTiming(0, { duration: TOOL_SWITCH_MS });
      y.value = withTiming(0, { duration: TOOL_SWITCH_MS });
    })();
    progress.value = withTiming(0, { duration: TOOL_SWITCH_MS }, (finished) => {
      if (finished) runOnJS(closed)();
    });
  }, [closed, points, progress, scale, x, y]);

  const cancel = useCallback(() => {
    const open = current.current;

    if (!open || asking.current) return;

    const discard = () => {
      if (current.current !== open) return;

      show(open.entry, open.entryLayers);
      leave();
    };

    if (strokes.current === open.entry) {
      // Терять нечего — крестик приглушён, а «назад» просто выходит.
      discard();
      return;
    }

    asking.current = true;
    void confirm({
      title: 'Отменить рисование?',
      message: 'Всё, что нарисовано в этот раз, пропадёт.',
      confirmLabel: 'ОК',
      cancelLabel: 'Отмена',
    })
      .then((confirmed) => {
        if (confirmed) discard();
      })
      .finally(() => {
        asking.current = false;
      });
  }, [leave, show]);

  const done = useCallback(() => {
    const open = current.current;

    if (!open) return;

    // Палец ещё рисует — штрих не теряется, ложится как есть. Уже
    // положенный штрих, точки которого UI-поток ещё не снял, — не второй раз.
    const pending = points.value;

    if (pending.length > 0 && strokeId.value !== finished.current) {
      const stroke = {
        brush: brush.value,
        color: color.value,
        width: width.value,
        points: pending.slice(),
      };
      const nextLayers = addStroke(stroke);

      if (nextLayers) {
        retireDrawingLayers(layersNow.current, nextLayers, [open.entryLayers]);
        strokes.current = [...strokes.current, stroke];
        layersNow.current = nextLayers;
      }
    }

    const result = normalizeDrawing(strokes.current);
    const resultLayers = layersNow.current;

    show(result, resultLayers);
    rememberDrawingLayers(open.asset.id, result, resultLayers);
    leave();
    commitPhotoEdit(open.asset, {
      ...(photoEditOf(open.asset.id) ?? EMPTY_EDIT),
      drawing: result,
    });
  }, [addStroke, brush, color, leave, points, show, strokeId, width]);

  return {
    open,
    session,
    progress,
    live,
    brush: brushSetting,
    selectedBrush,
    selectedColor,
    size,
    strokeId,
    ...flags,
    start,
    selectBrush,
    commitSize,
    finishStroke,
    undo,
    reset,
    cancel,
    done,
  };
}
