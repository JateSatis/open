import { useCallback, useMemo, useRef, useState } from 'react';
import type { View } from 'react-native';

import type { SavedMessage } from '@/api/saved';
import type { AnchorRect, MenuAnchor } from '@/features/chats/MessageContextMenu';
import type { SavedTab } from '@/features/saved/savedActions';
import type { SavedMenuTarget } from '@/features/saved/SavedMenu';

/**
 * Меню записи на вкладке: над чем открыто и окно списка, за которое копия
 * строки не вылезает. Запись — свежая из списка: теги и отметки меняются,
 * пока меню открыто.
 */
export function useSavedMenu(items: readonly SavedMessage[], tab: SavedTab) {
  const frameRef = useRef<View | null>(null);
  const [target, setTarget] = useState<SavedMenuTarget | null>(null);
  const [viewport, setViewport] = useState<AnchorRect | null>(null);
  const saved = useMemo(
    () => (target ? (items.find((item) => item.id === target.savedId) ?? null) : null),
    [items, target],
  );

  const open = useCallback(
    (item: SavedMessage, anchor: MenuAnchor) => {
      frameRef.current?.measureInWindow((x, y, width, height) =>
        setViewport({ x, y, width, height }),
      );
      setTarget({ savedId: item.id, anchor, tab });
    },
    [tab],
  );
  const close = useCallback(() => setTarget(null), []);

  return { frameRef, target, viewport, saved, open, close };
}
