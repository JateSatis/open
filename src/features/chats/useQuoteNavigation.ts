import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { listDeletedMessageIds, type QuotedMessage } from '@/api/chats';
import { islandItemKey } from '@/features/chats/islands/rows';
import type { ChatMessage } from '@/features/chats/messages/types';
import { showNotice } from '@/features/notifications/alertsStore';

type Jump = (rowKey: string, createdAt: string) => Promise<boolean>;

/** Куда прыгнуть в переписке: ключ строки и время, до которого догрузить историю. */
export type JumpTarget = { key: string; createdAt: string };

export type QuoteNavigation = {
  /**
   * Тап по цитате: к оригиналу; у ответа на несколько — по очереди.
   * `inChatId` — чат, в котором живёт ответ: у облачка островка это чат
   * оригинала, и прыгать надо туда.
   */
  openQuote: (message: ChatMessage, inChatId?: string) => void;
  /** Чат целиком — плашка островка: откуда пересылали. */
  openChat: (chatId: string) => void;
  /** Сообщение в его чате — «из <чат>» и «Перейти к оригиналу» у облачка островка. */
  openOriginal: (message: { id: string; chatId: string; createdAt: string }) => void;
};

function reportJump(found: boolean) {
  if (!found) showNotice('Не удалось найти сообщение', 'error');
}

/** Строка цитаты в чате ответа: само сообщение или облачко островка, где оно стоит. */
function quoteTarget(quote: Extract<QuotedMessage, { state: 'live' }>): JumpTarget {
  return quote.via
    ? { key: islandItemKey(quote.via.forwardId, quote.messageId), createdAt: quote.via.createdAt }
    : { key: quote.messageId, createdAt: quote.createdAt };
}

/**
 * Переходы из облачка: по цитате ответа — в этом же чате, по плашке островка
 * и «из <чат>» — в другой. Приход в чат с `jumpTo` в адресе — это второй
 * случай с другой стороны: как только история загружена, экран прыгает к
 * строке.
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

  /** В другой чат: к уже открытому ниже в стеке экрану, а не вторым экземпляром. */
  const goToChat = useCallback(
    (targetChatId: string, target: JumpTarget | null) => {
      if (targetChatId === chatId) {
        if (target) void jump(target.key, target.createdAt).then(reportJump);
        return;
      }

      const params = target
        ? {
            chatId: targetChatId,
            jumpTo: target.key,
            jumpAt: target.createdAt,
            jumpKey: String(Date.now()),
          }
        : { chatId: targetChatId };

      // Экран ищется по ключу: `dismissTo` сравнивает адрес вместе с
      // параметрами прыжка и не находит его.
      const state = navigation.getState();
      const index =
        state?.routes.findIndex(
          (route) =>
            route.name === '[chatId]' &&
            (route.params as { chatId?: string } | undefined)?.chatId === targetChatId,
        ) ?? -1;

      if (state && index !== -1) {
        if (target) {
          navigation.dispatch({
            type: 'SET_PARAMS',
            payload: { params },
            source: state.routes[index].key,
          });
        }
        navigation.dispatch({ type: 'POP', payload: { count: state.index - index } });
        return;
      }

      router.push({ pathname: '/chats/[chatId]', params });
    },
    [chatId, jump, navigation, router],
  );

  const openQuote = useCallback(
    (message: ChatMessage, inChatId: string = chatId) => {
      const live = message.replies.filter((quote) => quote.state === 'live');

      // По удалённому оригиналу тап ничего не делает.
      if (live.length === 0) return;

      const cursors = cursorsRef.current;
      const index = (cursors.get(message.id) ?? 0) % live.length;

      cursors.set(message.id, index + 1);
      goToChat(inChatId, quoteTarget(live[index]));
    },
    [chatId, goToChat],
  );

  const openChat = useCallback((targetChatId: string) => goToChat(targetChatId, null), [goToChat]);

  const openOriginal = useCallback(
    (message: { id: string; chatId: string; createdAt: string }) => {
      // Оригинал могли удалить после того, как загрузилась эта страница:
      // спросить базу дешевле, чем открыть чужой чат и ничего там не найти.
      void listDeletedMessageIds([message.id])
        .catch((): string[] => [])
        .then((deleted) => {
          if (deleted.includes(message.id)) {
            showNotice('Сообщение удалено');
            return;
          }

          goToChat(message.chatId, { key: message.id, createdAt: message.createdAt });
        });
    },
    [goToChat],
  );

  return { openQuote, openChat, openOriginal };
}
