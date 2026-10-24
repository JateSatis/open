import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

import { Spacing } from '@/theme';

/**
 * Какие чипы не влезли в первую строку — по их месту после переноса. Нужно
 * для «+N» свёрнутой полосы: сколько выбранных тегов не видно.
 */
export function useWrappedChips() {
  const [wrapped, setWrapped] = useState<ReadonlySet<string>>(() => new Set());

  const measure = useCallback(
    (id: string) => (event: LayoutChangeEvent) => {
      // Ниже первой строки — не влез в свёрнутую полосу.
      const below = event.nativeEvent.layout.y > Spacing.five / 2;

      setWrapped((current) => {
        if (current.has(id) === below) return current;

        const next = new Set(current);

        if (below) next.add(id);
        else next.delete(id);

        return next;
      });
    },
    [],
  );

  return { wrapped, measure };
}
