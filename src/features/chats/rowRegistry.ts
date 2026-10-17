import { createContext, type RefObject } from 'react';
import type { View } from 'react-native';

import type { AnchorRect } from '@/features/chats/MessageContextMenu';
import { measureInWindow } from '@/lib/measureInWindow';

export { measureInWindow };

/**
 * Строки переписки на экране — по ключу строки, чтобы найти и замерить её
 * снаружи списка (засчитанные показы). Свой на каждый экран чата — в стеке бывает
 * два экрана с одними и теми же строками.
 */
export type RowRegistry = {
  /** Строка на экране; отдаёт снятие с учёта. */
  register: (rowKey: string, ref: RefObject<View | null>) => () => void;
  /** Угол и размер строки в окне; `null` — строки нет на экране. */
  measure: (rowKey: string) => Promise<AnchorRect | null>;
};

export function createRowRegistry(): RowRegistry {
  const rows = new Map<string, RefObject<View | null>>();

  return {
    register(rowKey, ref) {
      rows.set(rowKey, ref);

      return () => {
        if (rows.get(rowKey) === ref) rows.delete(rowKey);
      };
    },
    measure: (rowKey) => measureInWindow(rows.get(rowKey)?.current),
  };
}

/** Реестр экрана чата. Вне переписки (комментарии в шите) его нет — строки не регистрируются. */
export const RowRegistryContext = createContext<RowRegistry | null>(null);
