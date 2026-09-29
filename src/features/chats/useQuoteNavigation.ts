import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { listDeletedMessageIds } from '@/api/chats';
import type { ChatMessage } from '@/features/chats/messages/types';
import { showNotice } from '@/features/notifications/alertsStore';

type Jump = (messageId: string, createdAt: string) => Promise<boolean>;

export type QuoteNavigation = {
  /** Тап по цитате: к оригиналу; у ответа на несколько — по очереди. */
  openQuote: (message: ChatMessage) => void;
  /** Тап по «Переслано от»: исходный чат и оригинал в нём. */
  openForwardOrigin: (message: ChatMessage) => void;
};

function reportJump(found: boolean) {
  if (!found) showNotice('Не удалось найти сообщение', 'error');
}

/**
 * Переходы из облачка к оригиналу: по цитате ответа — в этом же чате, по
 * «Переслано от» — в исходном. Приход в чат с `jumpTo` в адресе — это второй
 * случай с другой стороны: как только история загружена, экран прыгает к
 * сообщению.
 */
export function useQuoteNavigation(
  chatId: string,
  jump: Jump,
  isHistoryReady: boolean,
): QuoteNavigation {
  const router = useRouter();
  const navigation = useNavigation();
  const { jumpTo, jumpAt, jumpKey } = useLocalSearchParams<{
    jumpTo?: string;
    jumpAt?: string;
    jumpKey?: string;
  }>();
  // Какая цитата следующая у каждого ответа — как у полосы закрепов.
  const cursorsRef = useRef(new Map<string, number>());
  const handledJumpRef = useRef<string | null>(null);

  // Ключ, а не id сообщения: к тому же оригиналу могут прийти и второй раз,
  // вернувшись в уже открытый чат.
  const requestedJump = jumpKey ?? jumpTo;

  useEffect(() => {
    if (!isHistoryReady || !jumpTo || !jumpAt || handledJumpRef.current === requestedJump) return;

    handledJumpRef.current = requestedJump ?? null;
    void jump(jumpTo, jumpAt).then(reportJump);
  }, [isHistoryReady, jump, jumpAt, jumpTo, requestedJump]);

  const openQuote = useCallback(
    (message: ChatMessage) => {
      const live = message.replies.filter((quote) => quote.state === 'live');

      // По удалённому оригиналу тап ничего не делает.
      if (live.length === 0) return;

      const cursors = cursorsRef.current;
      const index = (cursors.get(message.id) ?? 0) % live.length;
      const target = live[index];

      cursors.set(message.id, index + 1);
      void jump(target.messageId, target.createdAt).then(reportJump);
    },
    [jump],
  );

  const openForwardOrigin = useCallback(
    (message: ChatMessage) => {
      const original = message.forward?.original;

      if (!original) {
        showNotice('Сообщение удалено');
        return;
      }

      // Оригинал могли удалить после того, как загрузилась эта страница:
      // спросить базу дешевле, чем открыть чужой чат и ничего там не найти.
      void listDeletedMessageIds([original.messageId])
        .catch((): string[] => [])
        .then((deleted) => {
          if (deleted.includes(original.messageId)) {
            showNotice('Сообщение удалено');
            return;
          }

          if (original.chatId === chatId) {
            void jump(original.messageId, original.createdAt).then(reportJump);
            return;
          }

          const params = {
            chatId: original.chatId,
            jumpTo: original.messageId,
            jumpAt: original.createdAt,
            jumpKey: String(Date.now()),
          };

          // Исходный чат уже открыт ниже в стеке — возвращаемся к нему, а не
          // открываем второй экземпляр: два экрана одного чата делили бы
          // один канал Realtime, и нижний перестал бы получать события.
          // Экран ищется по ключу: `dismissTo` сравнивает адрес вместе с
          // параметрами прыжка и не находит его.
          const state = navigation.getState();
          const index =
            state?.routes.findIndex(
              (route) =>
                route.name === '[chatId]' &&
                (route.params as { chatId?: string } | undefined)?.chatId === original.chatId,
            ) ?? -1;

          if (state && index !== -1) {
            navigation.dispatch({
              type: 'SET_PARAMS',
              payload: { params },
              source: state.routes[index].key,
            });
            navigation.dispatch({ type: 'POP', payload: { count: state.index - index } });
            return;
          }

          router.push({ pathname: '/chats/[chatId]', params });
        });
    },
    [chatId, jump, navigation, router],
  );

  return { openQuote, openForwardOrigin };
}
