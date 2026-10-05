import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  AppState,
  type AppStateStatus,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewabilityConfig,
  type ViewToken,
} from 'react-native';

import { recordMessageViews } from '@/api/messageViews';
import type { ChatListRow } from '@/features/chats/islands/rows';
import type { AnchorRect } from '@/features/chats/MessageContextMenu';

/** Как часто увиденное уходит на сервер. */
const FLUSH_MS = 2000;

/**
 * Строка видна, как только на экране хоть один её пиксель. Экран — рамка
 * списка: шапка, поле ввода и клавиатура лежат вне её и в видимое не входят.
 */
const VIEWABILITY: ViewabilityConfig = { itemVisiblePercentThreshold: 0 };

/** Сообщение, просмотр которого засчитывается, — с чатом, куда его записать. */
export type ViewedMessage = { id: string; chatId: string };

/**
 * Что засчитать за показ строки. Облачко островка — его оригинал (возможно,
 * из другого чата), плашка островка — ничего: островок не сообщение. Своё
 * себе не засчитывается, неотправленное ещё не существует на сервере.
 */
export function viewedMessageOf(
  row: ChatListRow,
  currentUserId: string | null,
): ViewedMessage | null {
  if (row.type === 'island-header') return null;

  const message = row.type === 'message' ? row.message : row.item.original;

  if (!message || message.kind === 'forward') return null;
  if (row.type === 'message' && row.message.status !== 'sent') return null;
  if (message.authorId !== null && message.authorId === currentUserId) return null;

  return { id: message.id, chatId: message.chatId };
}

/** На старте состояние бывает `unknown` — приложение при этом на экране. */
function isForeground(state: AppStateStatus | null): boolean {
  return state !== 'background' && state !== 'inactive';
}

/** Сессия экрана чата: случайный uuid v4. Не секрет — сервер ей и не верит. */
function newSessionId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);

    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export type MessageViewTracking = {
  viewabilityConfig: ViewabilityConfig;
  onViewableItemsChanged: (info: { viewableItems: ViewToken<ChatListRow>[] }) => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
};

/**
 * Учёт просмотров на экране переписки. Одно монтирование экрана — одна
 * сессия: сообщение в ней засчитывается один раз, сколько бы ни уезжало за
 * край. Пока приложение в фоне или экран чата не наверху, ничего не
 * засчитывается — а вернулись, и то, что сейчас на экране, засчитано.
 * Увиденное копится и уходит пачкой раз в пару секунд и при уходе с экрана.
 */
export function useMessageViews({
  chatId,
  currentUserId,
  isFocused,
  rows,
  autoscrollThreshold,
  measureRow,
  measureViewport,
}: {
  chatId: string;
  currentUserId: string | null;
  isFocused: boolean;
  /** Строки переписки — новыми вперёд, как в списке. */
  rows: ChatListRow[];
  /** Ближе этого к низу переписки список сам докручивает до нового сообщения. */
  autoscrollThreshold: number;
  /** Строка в окне по ключу; `null` — её нет на экране. */
  measureRow: (rowKey: string) => Promise<AnchorRect | null>;
  /** Рамка списка в окне — то, что человек видит. */
  measureViewport: () => Promise<AnchorRect | null>;
}): MessageViewTracking {
  const sessionId = useMemo(() => newSessionId(), []);
  const userRef = useRef(currentUserId);
  const visibleRef = useRef<ViewedMessage[]>([]);
  const sentRef = useRef(new Set<string>());
  const pendingRef = useRef(new Map<string, ViewedMessage>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusedRef = useRef(isFocused);
  const appActiveRef = useRef(isForeground(AppState.currentState));

  useEffect(() => {
    userRef.current = currentUserId;
  }, [currentUserId]);

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = null;

    const pending = [...pendingRef.current.values()];

    pendingRef.current.clear();

    if (pending.length === 0) return;

    const byChat = new Map<string, string[]>();

    for (const { id, chatId: target } of pending) {
      byChat.set(target, [...(byChat.get(target) ?? []), id]);
    }

    byChat.forEach((ids, target) => {
      recordMessageViews(target, ids, sessionId).catch(() => {
        // Не дошло — засчитаем, когда сообщение снова покажется на экране.
        ids.forEach((id) => {
          sentRef.current.delete(id);
        });
      });
    });
  }, [sessionId]);

  /** Засчитать то, что сейчас на экране, если смотреть сейчас есть кому. */
  const collect = useCallback(() => {
    if (!focusedRef.current || !appActiveRef.current) return;

    let added = false;

    for (const viewed of visibleRef.current) {
      if (sentRef.current.has(viewed.id)) continue;

      sentRef.current.add(viewed.id);
      pendingRef.current.set(viewed.id, viewed);
      added = true;
    }

    if (added && !timerRef.current) timerRef.current = setTimeout(flush, FLUSH_MS);
  }, [flush]);

  // FlatList не принимает смену `onViewableItemsChanged` на лету: обработчик
  // один на всю жизнь списка, свежие значения — через ref.
  const collectRef = useRef(collect);

  useEffect(() => {
    collectRef.current = collect;
  }, [collect]);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<ChatListRow>[] }) => {
      visibleRef.current = viewableItems.flatMap((token) => {
        const viewed = token.item ? viewedMessageOf(token.item, userRef.current) : null;

        return viewed ? [viewed] : [];
      });
      collectRef.current();
    },
    [],
  );

  // Пришедшее снизу, пока человек у низа переписки, — на экране: список сам
  // докручивает до него. Но `onViewableItemsChanged` об этом не узнает: после
  // вставки в начало с `maintainVisibleContentPosition` VirtualizedList ждёт
  // события прокрутки, а у самого низа его не бывает, и видимость стоит до
  // первой прокрутки пальцем. Поэтому новые строки внизу меряются здесь — и
  // засчитываются те, что легли в рамку списка хоть пикселем: пачка, пришедшая
  // за время отсутствия, на экран целиком не помещается.
  const offsetRef = useRef(0);
  const firstKeyRef = useRef<string | null>(null);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offsetRef.current = event.nativeEvent.contentOffset.y;
  }, []);

  useEffect(() => {
    const previous = firstKeyRef.current;

    firstKeyRef.current = rows[0]?.key ?? null;

    if (previous === null || offsetRef.current > autoscrollThreshold) return;

    const end = rows.findIndex((row) => row.key === previous);

    // Прежней первой строки нет — история пересобрана, а не дополнена снизу.
    if (end <= 0) return;

    const arrived = rows.slice(0, end).flatMap((row) => {
      const viewed = viewedMessageOf(row, userRef.current);

      return viewed ? [{ key: row.key, viewed }] : [];
    });

    if (arrived.length === 0) return;

    let cancelled = false;

    // Замерить, когда список разложил новые строки.
    const frame = requestAnimationFrame(() => {
      void Promise.all([
        measureViewport(),
        ...arrived.map(({ key }) => measureRow(key)),
      ]).then(([viewport, ...rects]) => {
        if (cancelled || !viewport) return;

        const onScreen = arrived
          .filter((_, index) => {
            const rect = rects[index];

            return (
              rect !== null &&
              rect.y < viewport.y + viewport.height &&
              rect.y + rect.height > viewport.y
            );
          })
          .map(({ viewed }) => viewed);

        if (onScreen.length === 0) return;

        visibleRef.current = [...onScreen, ...visibleRef.current];
        collect();
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [autoscrollThreshold, collect, measureRow, measureViewport, rows]);

  useEffect(() => {
    focusedRef.current = isFocused;

    if (isFocused) collect();
    else flush();
  }, [collect, flush, isFocused]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      appActiveRef.current = isForeground(state);

      if (appActiveRef.current) collect();
      else flush();
    });

    return () => subscription.remove();
  }, [collect, flush]);

  // Ушли с экрана — увиденное уходит сразу, не дожидаясь таймера.
  useEffect(() => () => flush(), [flush, chatId]);

  return { viewabilityConfig: VIEWABILITY, onViewableItemsChanged, onScroll };
}
