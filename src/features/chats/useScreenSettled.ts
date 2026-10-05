import { useNavigation, type NativeStackNavigationProp } from 'expo-router';
import { useEffect, useState } from 'react';

/** Переход без события `transitionEnd` (тесты, сменившийся навигатор) не держит экран дольше. */
const SETTLE_FALLBACK_MS = 700;

/**
 * Экран в фокусе и его переход доиграл. Окно (`Modal`), показанное посреди
 * перехода стека на Android, остаётся пустым: диалог есть, содержимого нет.
 * Поэтому шит, который открывается сам при приходе на экран, ждёт этого.
 */
export function useScreenSettled(isFocused: boolean): boolean {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!isFocused) return;

    const settle = () => setSettled(true);
    const timer = setTimeout(settle, SETTLE_FALLBACK_MS);
    const unsubscribe = navigation.addListener('transitionEnd', settle);

    return () => {
      clearTimeout(timer);
      unsubscribe();
      setSettled(false);
    };
  }, [isFocused, navigation]);

  return isFocused && settled;
}
