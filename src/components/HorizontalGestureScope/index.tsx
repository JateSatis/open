import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { GestureType } from 'react-native-gesture-handler';

const Context = createContext<readonly GestureType[]>([]);

export type HorizontalGestureScopeProps = {
  /** Горизонтальный жест этого уровня: свайп-ответ строки, листание разделов. */
  gesture: GestureType;
  children: ReactNode;
};

/**
 * Горизонтальные жесты, внутри которых лежит содержимое: свайп-ответ строки
 * переписки, листание разделов канала. Прокручиваемая вбок полоса внутри них
 * блокирует их все (`useEnclosingHorizontalGestures`): касание, начатое на
 * ней, прокручивает её, а не тянет облачко и не листает раздел. Уровни
 * складываются: строка в разделе канала видит оба жеста.
 */
export function HorizontalGestureScope({ gesture, children }: HorizontalGestureScopeProps) {
  const outer = useContext(Context);
  const value = useMemo(() => [...outer, gesture], [gesture, outer]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Горизонтальные жесты вокруг: полоса с прокруткой вбок их блокирует. */
export function useEnclosingHorizontalGestures(): readonly GestureType[] {
  return useContext(Context);
}
