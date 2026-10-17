// Мутация `.value` у shared value — штатный способ пользоваться Reanimated.
/* eslint-disable react-hooks/immutability */
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardController } from 'react-native-keyboard-controller';
import {
  Easing,
  runOnJS,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { closeMediaPreview, measureGridCell, type Rect } from './previewStore';

/** Перелёт из плитки и обратно. */
const FLIGHT_MS = 280;
const FLIGHT_EASING = Easing.out(Easing.cubic);
/** Столько ждём превью перед перелётом, дальше летим без него. */
const LAUNCH_FALLBACK_MS = 400;
/** Уход за край экрана, когда плитки не видно, — как у просмотрщика. */
const AWAY_MS = 200;

export type PreviewFlight = {
  flight: SharedValue<number>;
  origin: SharedValue<Rect | null>;
  fade: SharedValue<number>;
  /**
   * Насколько файл утянут пальцем вверх или вниз. Уход в плитку стартует
   * отсюда же, а не с места.
   */
  lift: SharedValue<number>;
  /** Предпросмотр уходит: касания не принимаются, видео уступает кадру. */
  leaving: boolean;
  /** Превью активной страницы нарисовано — пора лететь из плитки. */
  launch: () => void;
  /**
   * Назад в сетку: в плитку файла, если она видна. Иначе свайп (`direction`
   * — его сторона) уносит файл за край, а стрелка и «назад» гасят на месте.
   */
  leave: (assetId: string, direction?: -1 | 0 | 1) => void;
  /** Отправка: шит уезжает вниз, предпросмотр тает над ним за то же время. */
  dissolve: () => void;
};

/**
 * Появление и уход предпросмотра. Файл вылетает из плитки, из которой его
 * открыли, а улетает в плитку файла, на котором ушли, — если её видно в
 * сетке. Не видно — файл гаснет на месте, а сетка не двигается: доскролл
 * свёрнутого шита двигал бы сам шит, его высоту ведёт тот же скролл.
 */
export function usePreviewFlight(
  initialOrigin: Rect | null,
  gridViewport: { top: number; bottom: number },
  screenHeight: number,
): PreviewFlight {
  const flight = useSharedValue(0);
  const origin = useSharedValue<Rect | null>(initialOrigin);
  const fade = useSharedValue(1);
  const lift = useSharedValue(0);
  const [leaving, setLeaving] = useState(false);

  /**
   * Перелёт начинается, когда превью активной страницы уже нарисовано: иначе
   * анимация отыграла бы впустую, а фото появилось бы в конце, рывком. Если
   * превью почему-то не пришло — не держим человека дольше страховки.
   */
  const launched = useRef(false);
  const launch = useCallback(() => {
    if (launched.current) return;

    launched.current = true;
    flight.value = withTiming(1, { duration: FLIGHT_MS, easing: FLIGHT_EASING });
  }, [flight]);

  useEffect(() => {
    const fallback = setTimeout(launch, LAUNCH_FALLBACK_MS);

    return () => clearTimeout(fallback);
  }, [launch]);

  const leave = useCallback(
    (assetId: string, direction: -1 | 0 | 1 = 0) => {
      if (leaving) return;

      setLeaving(true);
      void KeyboardController.dismiss();

      void measureGridCell(assetId).then((rect) => {
        const center = rect ? rect.y + rect.height / 2 : -1;
        const visible = rect !== null && center > gridViewport.top && center < gridViewport.bottom;

        if (visible) {
          origin.value = rect;
          flight.value = withTiming(0, { duration: FLIGHT_MS, easing: FLIGHT_EASING }, (done) => {
            if (done) runOnJS(closeMediaPreview)();
          });
          return;
        }

        if (direction !== 0) {
          lift.value = withTiming(direction * screenHeight, { duration: AWAY_MS }, (done) => {
            if (done) runOnJS(closeMediaPreview)();
          });
          return;
        }

        fade.value = withTiming(0, { duration: FLIGHT_MS }, (done) => {
          if (done) runOnJS(closeMediaPreview)();
        });
      });
    },
    [fade, flight, gridViewport.bottom, gridViewport.top, leaving, lift, origin, screenHeight],
  );

  const dissolve = useCallback(() => {
    setLeaving(true);
    void KeyboardController.dismiss();
    fade.value = withTiming(0, { duration: FLIGHT_MS });
  }, [fade]);

  return { flight, origin, fade, lift, leaving, launch, leave, dissolve };
}
