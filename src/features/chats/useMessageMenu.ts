import { impactAsync, ImpactFeedbackStyle } from 'expo-haptics';
import { useCallback, useState } from 'react';
import { Keyboard } from 'react-native';

import type { AnchorRect } from '@/features/chats/MessageContextMenu';
import { setLiftedMessage } from '@/features/chats/MessageRow/liftedStore';

/** Над чем открыто меню и где: строка переписки или комментарий. */
export type MenuTarget<T> = { item: T; anchor: AnchorRect };

/**
 * Контекстное меню: над чем оно открыто и где. `keyOf` — ключ строки
 * списка: её копия поднимается над затемнением, а сама строка прячется.
 */
export function useMessageMenu<T>(keyOf: (item: T) => string) {
  const [target, setTarget] = useState<MenuTarget<T> | null>(null);

  const open = useCallback(
    (item: T, anchor: AnchorRect) => {
      impactAsync(ImpactFeedbackStyle.Medium).catch(() => undefined);
      Keyboard.dismiss();
      setLiftedMessage(keyOf(item));
      setTarget({ item, anchor });
    },
    [keyOf],
  );

  const close = useCallback(() => {
    setLiftedMessage(null);
    setTarget(null);
  }, []);

  return { target, open, close };
}
