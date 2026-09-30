import type { ReactNode } from 'react';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReturnBarVisible } from '@/features/streams/ReturnToCallBar';

/**
 * Пока над навигатором стоит «Вернуться к звонку», верхний отступ под
 * строку состояния уже занят полосой: экраны под ней не должны отступать
 * его второй раз.
 */
export function CallInsets({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const barVisible = useReturnBarVisible();

  if (!barVisible) return children;

  return (
    <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
      {children}
    </SafeAreaInsetsContext.Provider>
  );
}
