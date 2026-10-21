import { createContext, useContext, useEffect, useLayoutEffect, type ReactNode } from 'react';
import { BackHandler } from 'react-native';

import type { LeaveGuard, SlideBack } from './useSlideBack';

// Связь содержимого со страницей, внутри которой оно лежит (`SlidePage`).
// Отдельно от самой страницы: полю ввода и переписке нужны только эти хуки,
// без жестов и навигации.

type SlidePageContextValue = {
  slide: SlideBack;
  setHeader: (header: ReactNode) => void;
};

export const SlidePageContext = createContext<SlidePageContextValue | null>(null);

/** Страница, внутри которой мы, или `null` — экран без въезда-ухода. */
export function useSlidePage(): SlideBack | null {
  return useContext(SlidePageContext)?.slide ?? null;
}

/**
 * Шапка страницы, которую знает её содержимое (переписка знает имя,
 * подпись, кнопки): встаёт сверху страницы, над всем, что под ней (у канала —
 * над разделами). Вне страницы рисуется на месте.
 */
export function SlidePageHeader({ children }: { children: ReactNode }) {
  const context = useContext(SlidePageContext);
  const setHeader = context?.setHeader;

  // До отрисовки кадра: страница не мелькает без шапки.
  useLayoutEffect(() => {
    setHeader?.(children);
  });

  useLayoutEffect(() => () => setHeader?.(null), [setHeader]);

  return context ? null : <>{children}</>;
}

/**
 * «Назад» забирает содержимое страницы, пока `handler` готов его взять
 * (выход из выбора сообщений, из правки, закрыть панель эмодзи): и кнопка, и
 * системный жест. Вне страницы — обычным `BackHandler`.
 */
export function useSlidePageBack(enabled: boolean, handler: () => void) {
  const page = useSlidePage();

  useEffect(() => {
    if (!enabled) return;

    if (page) {
      return page.interceptBack(() => {
        handler();
        return true;
      });
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handler();
      return true;
    });

    return () => subscription.remove();
  }, [enabled, handler, page]);
}

/** Спросить перед уходом со страницы (`LeaveGuard`). */
export function useSlidePageLeaveGuard(guard: LeaveGuard) {
  const page = useSlidePage();

  useEffect(() => page?.guardLeave(guard), [guard, page]);
}

/** Пока `held`, свайп страницы не начинается. */
export function useSlidePageSwipeHold(held: boolean) {
  const page = useSlidePage();

  useEffect(() => (held ? page?.holdSwipe() : undefined), [held, page]);
}

/** Свайп страницы начался — убрать то, что не должно ехать вместе с ней. */
export function useSlidePageSwipeStart(listener: () => void) {
  const page = useSlidePage();

  useEffect(() => page?.onSwipeStart(listener), [listener, page]);
}

