import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  AppState,
  type AppStateStatus,
  type ViewabilityConfig,
  type ViewToken,
} from 'react-native';

import { recordMessageViews } from '@/api/messageViews';
import type { ChatListRow } from '@/features/chats/islands/rows';

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
};

/**
 * Учёт просмотров на экране переписки. Одно монтирование экрана — одна
 * сессия: сообщение в ней засчитывается один раз, сколько бы ни уезжало за
 * край. Пока приложение в фоне или экран чата не наверху, ничего не
 * засчитывается — а вернулись, и то, что сейчас на экране, засчитано.
 * Увиденное копится и уходит пачкой раз в пару секунд и при уходе с экрана.
 */
export function useMessageViews(
  chatId: string,
  currentUserId: string | null,
  isFocused: boolean,
): MessageViewTracking {
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

  return { viewabilityConfig: VIEWABILITY, onViewableItemsChanged };
}
