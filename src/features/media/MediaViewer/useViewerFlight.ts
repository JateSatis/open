// Мутация `.value` у shared value — штатный способ пользоваться Reanimated.
/* eslint-disable react-hooks/immutability */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  runOnJS,
  runOnUI,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { dismissOpacity } from './viewerMath';

import { AWAY_MS, FLIGHT_EASING, FLIGHT_MS } from '@/features/media/flightTiming';
import {
  setHiddenTile,
  tileVisible,
  type Rect,
  type TileRect,
  type TileRegistry,
} from '@/features/media/tileRegistry';

/** Столько ждём картинку плитки перед перелётом, дальше летим без неё. */
const LAUNCH_FALLBACK_MS = 250;

/** Общая анимация просмотра — её читает активная страница. */
export type ViewerMotion = {
  /** 0 — медиа в плитке, 1 — на месте. */
  flight: SharedValue<number>;
  /** Плитка, из которой медиа вылетело или в которую улетает. */
  origin: SharedValue<TileRect | null>;
  /**
   * Откуда медиа уходит в плитку: туда, куда его утянул палец или увеличил
   * щипок. `null` — со своего места.
   */
  from: SharedValue<Rect | null>;
  /** Гаснет на месте (плитки не видно): 1 — видно. */
  fade: SharedValue<number>;
};

type Zoom = {
  scale: SharedValue<number>;
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  dismissY: SharedValue<number>;
  closing: SharedValue<boolean>;
};

type Params = {
  initialOrigin: TileRect | null;
  /** Плитки, из которых открыли просмотр; нет — уходить некуда, только за край. */
  tiles: TileRegistry | null;
  /** Видимая область списка с плитками; нет — весь экран. */
  measureViewport: (() => Promise<Rect | null>) | null;
  width: number;
  height: number;
  zoom: Zoom;
  onClosed: () => void;
};

/**
 * Появление и уход просмотра. Медиа вырастает из плитки, по которой тапнули,
 * и уходит в плитку файла, на котором закрыли, — с того места и размера, где
 * его оставили палец и щипок. Плитки не видно: свайп уносит медиа за край в
 * свою сторону, крестик и «назад» — гасят на месте. Список под просмотром
 * не прокручивается.
 */
export function useViewerFlight({
  initialOrigin,
  tiles,
  measureViewport,
  width,
  height,
  zoom,
  onClosed,
}: Params) {
  const flight = useSharedValue(0);
  const origin = useSharedValue<TileRect | null>(initialOrigin);
  const from = useSharedValue<Rect | null>(null);
  // Без плитки (аватарка на странице информации) медиа проявляется на месте,
  // как раньше проявлялось всё окно.
  const fade = useSharedValue(initialOrigin ? 1 : 0);
  /** Затемнение фона в момент ухода: оно гаснет оттуда, а не от полного. */
  const dimAtLeave = useSharedValue(-1);
  const [leaving, setLeaving] = useState(false);
  /** Перелёт из плитки закончился: можно запускать видео. */
  const [settled, setSettled] = useState(false);
  const leavingRef = useRef(false);
  const { scale, tx, ty, dismissY, closing } = zoom;

  const finish = useCallback(() => {
    // Плитка проявляется раньше, чем окно уходит: кадр, где нет ни той, ни
    // другой картинки, мигнул бы пустотой.
    setHiddenTile(null, null);
    requestAnimationFrame(() => requestAnimationFrame(onClosed));
  }, [onClosed]);

  useEffect(() => () => setHiddenTile(null, null), []);

  /**
   * Перелёт стартует, когда окно уже на экране и картинка плитки в нём
   * нарисована: иначе анимация отыграла бы за невидимым окном или пустой
   * рамкой. Не дождались картинки — летим без неё.
   */
  const launched = useRef(false);
  const launch = useCallback(
    (sourceId: string | null) => {
      if (launched.current || leavingRef.current) return;

      launched.current = true;
      if (sourceId) setHiddenTile(tiles, sourceId);
      if (!initialOrigin) fade.value = withTiming(1, { duration: FLIGHT_MS });
      flight.value = withTiming(1, { duration: FLIGHT_MS, easing: FLIGHT_EASING }, (done) => {
        if (done) runOnJS(setSettled)(true);
      });
    },
    [fade, flight, initialOrigin, tiles],
  );

  const flyBack = useCallback(
    (tile: TileRect, base: Rect) => {
      runOnUI((target: TileRect, media: Rect) => {
        'worklet';
        // Где медиа сейчас на экране: увеличение и сдвиг — вокруг центра.
        const s = scale.value;
        const centerX = width / 2 + (media.x + media.width / 2 - width / 2) * s + tx.value;
        const centerY =
          height / 2 + (media.y + media.height / 2 - height / 2) * s + ty.value + dismissY.value;

        dimAtLeave.value = flight.value * dismissOpacity(dismissY.value, height);
        from.value = {
          x: centerX - (media.width * s) / 2,
          y: centerY - (media.height * s) / 2,
          width: media.width * s,
          height: media.height * s,
        };
        // Тот же кадр: положение теперь держит `from`, а не жесты.
        scale.value = 1;
        tx.value = 0;
        ty.value = 0;
        dismissY.value = 0;
        origin.value = target;
        flight.value = withTiming(0, { duration: FLIGHT_MS, easing: FLIGHT_EASING }, (done) => {
          if (done) runOnJS(finish)();
        });
      })(tile, base);
    },
    [dimAtLeave, dismissY, finish, flight, from, height, origin, scale, tx, ty, width],
  );

  const flyAway = useCallback(
    (direction: -1 | 1) => {
      dismissY.value = withTiming(direction * height, { duration: AWAY_MS }, (done) => {
        if (done) runOnJS(finish)();
      });
    },
    [dismissY, finish, height],
  );

  const fadeOut = useCallback(() => {
    fade.value = withTiming(0, { duration: FLIGHT_MS }, (done) => {
      if (done) runOnJS(finish)();
    });
  }, [fade, finish]);

  /**
   * Закрыть просмотр на файле `id`, чья вписанная рамка — `base`. `direction`
   * — куда утянули пальцем; `0` — крестик или «назад».
   */
  const leave = useCallback(
    (id: string | undefined, base: Rect, direction: -1 | 0 | 1) => {
      if (leavingRef.current) return;

      leavingRef.current = true;
      closing.value = true;
      setLeaving(true);

      void Promise.all([
        id && tiles ? tiles.measure(id) : Promise.resolve(null),
        measureViewport ? measureViewport() : Promise.resolve(null),
      ]).then(([tile, viewport]) => {
        if (tileVisible(tile, viewport)) {
          flyBack(tile, base);
          return;
        }

        setHiddenTile(null, null);
        if (direction !== 0) flyAway(direction);
        else fadeOut();
      });
    },
    [closing, fadeOut, flyAway, flyBack, measureViewport, tiles],
  );

  const backgroundStyle = useAnimatedStyle(() => ({
    opacity:
      dimAtLeave.value >= 0
        ? dimAtLeave.value * flight.value * fade.value
        : flight.value * dismissOpacity(dismissY.value, height) * fade.value,
  }));

  const chromeStyle = useAnimatedStyle(() => ({
    opacity:
      dimAtLeave.value >= 0
        ? 0
        : flight.value * dismissOpacity(dismissY.value, height) * fade.value,
  }));

  return {
    motion: { flight, origin, from, fade },
    leaving,
    settled,
    launch,
    leave,
    backgroundStyle,
    chromeStyle,
    fallbackMs: LAUNCH_FALLBACK_MS,
  };
}
