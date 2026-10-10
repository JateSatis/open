// Учёт показов: что сейчас на экране, когда это засчитать и как отправить.
// Общая механика просмотров сообщений в переписке и попсов в просмотре.
//
// Одно монтирование — одна сессия. Пока приложение в фоне или экран не
// наверху, ничего не засчитывается — а вернулись, и то, что сейчас на
// экране, засчитано. Засчитанное копится и уходит пачкой раз в пару секунд,
// при уходе с экрана, в фон и при размонтировании.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/** Как часто засчитанное уходит на сервер. */
const FLUSH_MS = 2000;

/**
 * Когда показ того же снова засчитывается:
 * - `session` — один раз за сессию, сколько бы ни уезжал за край и ни
 *   возвращался (сообщения в переписке);
 * - `appearance` — каждый раз, когда снова появился на экране после ухода
 *   (поп, ставший активной страницей ещё раз).
 */
export type ViewRepeat = 'session' | 'appearance';

/** На старте состояние бывает `unknown` — приложение при этом на экране. */
function isForeground(state: AppStateStatus | null): boolean {
  return state !== 'background' && state !== 'inactive';
}

/** Сессия экрана: случайный uuid v4. Не секрет — сервер ей и не верит. */
export function newSessionId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);

    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export type ViewBatcher<T> = {
  /** Что на экране сейчас — целиком, вместо прежнего. */
  setVisible: (items: T[]) => void;
  /** Ещё что-то легло на экран, а прежнее осталось. */
  addVisible: (items: T[]) => void;
  /** Отправить накопленное сейчас, не дожидаясь таймера. */
  flush: () => void;
};

export function useViewBatcher<T extends { id: string }>({
  isFocused,
  send,
  repeat,
}: {
  isFocused: boolean;
  /**
   * Отправить пачку. Отдаёт id, которые не дошли (часть пачки), отказ — не
   * дошло ничего. Не дошедшее засчитаем, когда снова покажется на экране.
   */
  send: (items: T[], sessionId: string) => Promise<string[] | void>;
  repeat: ViewRepeat;
}): ViewBatcher<T> {
  const sessionId = useMemo(() => newSessionId(), []);
  const visibleRef = useRef<T[]>([]);
  const sentRef = useRef(new Set<string>());
  const pendingRef = useRef(new Map<string, T>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusedRef = useRef(isFocused);
  const appActiveRef = useRef(isForeground(AppState.currentState));
  const sendRef = useRef(send);

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = null;

    const pending = [...pendingRef.current.values()];

    pendingRef.current.clear();

    if (pending.length === 0) return;

    const forget = (ids: string[]) =>
      ids.forEach((id) => {
        sentRef.current.delete(id);
      });

    sendRef
      .current(pending, sessionId)
      .then((failed) => forget(failed ?? []))
      .catch(() => forget(pending.map(({ id }) => id)));
  }, [sessionId]);

  /** Засчитать то, что сейчас на экране, если смотреть сейчас есть кому. */
  const collect = useCallback(() => {
    if (!focusedRef.current || !appActiveRef.current) return;

    let added = false;

    for (const item of visibleRef.current) {
      if (sentRef.current.has(item.id)) continue;

      sentRef.current.add(item.id);
      pendingRef.current.set(item.id, item);
      added = true;
    }

    if (added && !timerRef.current) timerRef.current = setTimeout(flush, FLUSH_MS);
  }, [flush]);

  const setVisible = useCallback(
    (items: T[]) => {
      if (repeat === 'appearance') {
        const shown = new Set(items.map(({ id }) => id));

        // Ушло с экрана — следующее появление снова показ. Ещё не отправленное
        // остаётся в пачке одним показом: id в ней не повторяется.
        for (const id of [...sentRef.current]) {
          if (!shown.has(id)) sentRef.current.delete(id);
        }
      }

      visibleRef.current = items;
      collect();
    },
    [collect, repeat],
  );

  const addVisible = useCallback(
    (items: T[]) => {
      visibleRef.current = [...items, ...visibleRef.current];
      collect();
    },
    [collect],
  );

  useEffect(() => {
    focusedRef.current = isFocused;

    if (isFocused) collect();
    else flush();
  }, [collect, flush, isFocused]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      appActiveRef.current = isForeground(state);

      if (appActiveRef.current) collect();
      else flush();
    });

    return () => subscription.remove();
  }, [collect, flush]);

  // Ушли с экрана — засчитанное уходит сразу, не дожидаясь таймера.
  useEffect(() => () => flush(), [flush]);

  return useMemo(() => ({ setVisible, addVisible, flush }), [addVisible, flush, setVisible]);
}
