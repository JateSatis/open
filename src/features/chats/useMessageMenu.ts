import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';

import type { AnchorRect, MenuAnchor } from '@/features/chats/MessageContextMenu';
import { setLiftedMessage } from '@/features/chats/MessageRow/liftedStore';

/** Над чем открыто меню и где: строка переписки или комментарий. */
export type MenuTarget<T> = {
  item: T;
  anchor: MenuAnchor;
  /** Окно списка — копия облачка над затемнением рисуется только в нём. */
  viewport: AnchorRect | null;
};

/**
 * Контекстное меню: над чем оно открыто и где. `keyOf` — ключ строки
 * списка: её копия поднимается над затемнением, а сама строка прячется.
 * `measureViewport` — окно списка; меряется до открытия, чтобы копия с
 * первого кадра стояла обрезанной так же, как облачко в списке.
 */
export function useMessageMenu<T>(
  keyOf: (item: T) => string,
  measureViewport?: () => Promise<AnchorRect | null>,
) {
  const [target, setTarget] = useState<MenuTarget<T> | null>(null);
  // Номер последнего открытия: замер окна асинхронный, и ответ, пришедший
  // после нового открытия, закрытия или ухода с экрана, уже ничего не открывает.
  const requestRef = useRef(0);

  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    [],
  );

  const open = useCallback(
    (item: T, anchor: MenuAnchor) => {
      Keyboard.dismiss();

      const request = ++requestRef.current;
      const show = (viewport: AnchorRect | null) => {
        if (request !== requestRef.current) return;

        setLiftedMessage(keyOf(item));
        setTarget({ item, anchor, viewport });
      };

      if (measureViewport) void measureViewport().then(show);
      else show(null);
    },
    [keyOf, measureViewport],
  );

  const close = useCallback(() => {
    requestRef.current += 1;
    setLiftedMessage(null);
    setTarget(null);
  }, []);

  return { target, open, close };
}
