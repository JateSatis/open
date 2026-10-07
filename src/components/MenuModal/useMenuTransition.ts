import { useCallback, useEffect, useRef } from 'react';
import { runOnJS, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

export const MENU_OPEN_MS = 200;
export const MENU_CLOSE_MS = 140;

export type MenuTransition = {
  /** 0 — закрыто, 1 — открыто. На нём висят затемнение и само меню. */
  progress: SharedValue<number>;
  /**
   * Закрывает с анимацией и только потом выполняет `after` — следующим
   * кадром: диалог подтверждения или переход не ложится поверх меню.
   */
  close: (after: (() => void) | null) => void;
};

/**
 * Открытие и закрытие всплывающего меню. Каждое новое значение `openedFor`
 * (не null) — новое открытие с нуля; `onClosed` зовётся, когда закрытие
 * доиграло, — тогда владелец снимает меню.
 */
export function useMenuTransition(openedFor: unknown, onClosed: () => void): MenuTransition {
  const progress = useSharedValue(0);
  const closingRef = useRef(false);
  const pendingRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (openedFor === null || openedFor === undefined || openedFor === false) return;

    closingRef.current = false;
    pendingRef.current = null;
    progress.set(0);
    progress.set(withTiming(1, { duration: MENU_OPEN_MS }));
  }, [openedFor, progress]);

  const finish = useCallback(() => {
    const after = pendingRef.current;

    pendingRef.current = null;
    onClosed();

    // Действие — следующим кадром, отдельным от закрытия проходом. Иначе
    // окно меню исчезло бы только вместе с тем, что делает действие (вход в
    // выбор перерисовывает весь список), и касания, сделанные сразу после
    // выбора пункта, уходили бы в ещё не закрытое окно.
    if (after) requestAnimationFrame(after);
  }, [onClosed]);

  const close = useCallback(
    (after: (() => void) | null) => {
      if (closingRef.current) return;

      closingRef.current = true;
      pendingRef.current = after;
      progress.set(
        withTiming(0, { duration: MENU_CLOSE_MS }, (finished) => {
          if (finished) runOnJS(finish)();
        }),
      );
    },
    [finish, progress],
  );

  return { progress, close };
}
