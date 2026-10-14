import { useEffect, useState } from 'react';

/**
 * Значение после паузы в изменениях: запрос к серверу не уходит на каждую
 * букву быстрого набора. Пустое — сразу: очищенное поле не ждёт паузы.
 */
export function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), value === '' ? 0 : delay);
    return () => clearTimeout(timer);
  }, [delay, value]);

  return value === '' ? '' : debounced;
}
