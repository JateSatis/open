import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { GestureResponderEvent, PressableProps } from 'react-native';

/** Второй тап двойного — не позже этого после первого; столько же ждёт одиночный. */
const DOUBLE_TAP_GAP_MS = 250;
/** Дольше — удержание для 2×. */
const LONG_PRESS_MS = 300;

export type SurfacePressHandlers = {
  /** Одиночный тап — когда ясно, что второго не будет. */
  onTap: () => void;
  /** Двойной тап и каждый следующий в серии — в точке касания. */
  onDoubleTap: (x: number, y: number) => void;
  /** Удержание началось (`true`) и закончилось (`false`). */
  onHold: (holding: boolean) => void;
};

/**
 * Тап, двойной тап и удержание по видео — на системе касаний React Native, а
 * не жестами Gesture Handler: тот отдаёт касание всем вью под пальцем, и тап
 * по подписи, «+» или реакции заодно ставил видео на паузу. Здесь касание
 * получает только верхний элемент, а начавшееся листание само его отменяет.
 */
export function useSurfacePress({
  onTap,
  onDoubleTap,
  onHold,
}: SurfacePressHandlers): Pick<
  PressableProps,
  'onPress' | 'onLongPress' | 'onPressOut' | 'delayLongPress'
> {
  const singleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapAt = useRef(0);
  const inSeries = useRef(false);
  const holding = useRef(false);
  const handlers = useRef({ onTap, onDoubleTap, onHold });

  useEffect(() => {
    handlers.current = { onTap, onDoubleTap, onHold };
  }, [onDoubleTap, onHold, onTap]);

  useEffect(
    () => () => {
      if (singleTimer.current) clearTimeout(singleTimer.current);
    },
    [],
  );

  const onPress = useCallback((event: GestureResponderEvent) => {
    const now = Date.now();
    const quick = now - lastTapAt.current <= DOUBLE_TAP_GAP_MS;

    lastTapAt.current = now;

    if (quick && (singleTimer.current || inSeries.current)) {
      if (singleTimer.current) clearTimeout(singleTimer.current);

      singleTimer.current = null;
      inSeries.current = true;
      handlers.current.onDoubleTap(event.nativeEvent.locationX, event.nativeEvent.locationY);
      return;
    }

    inSeries.current = false;
    singleTimer.current = setTimeout(() => {
      singleTimer.current = null;
      handlers.current.onTap();
    }, DOUBLE_TAP_GAP_MS);
  }, []);

  const onLongPress = useCallback(() => {
    holding.current = true;
    handlers.current.onHold(true);
  }, []);

  const onPressOut = useCallback(() => {
    if (!holding.current) return;

    holding.current = false;
    handlers.current.onHold(false);
  }, []);

  return useMemo(
    () => ({ onPress, onLongPress, onPressOut, delayLongPress: LONG_PRESS_MS }),
    [onLongPress, onPress, onPressOut],
  );
}
