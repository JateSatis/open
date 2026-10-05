import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { listDeletedMessageIds, type QuotedMessage } from '@/api/chats';
import { islandItemKey } from '@/features/chats/islands/rows';
import { showNotice } from '@/features/notifications/alertsStore';

type Jump = (rowKey: string, createdAt: string) => Promise<boolean>;

/** Куда прыгнуть в переписке: ключ строки и время, до которого догрузить историю. */
export type JumpTarget = { key: string; createdAt: string };

/**
 * Комментарий, к которому пришли: шит его сообщения и само сообщение в
 * переписке. `target: null` — сообщение удалено, прыгать некуда.
 */
export type CommentFocus = { messageId: string; commentId: string; target: JumpTarget | null };

export type QuoteNavigation = {
  /**
   * Тап по цитате — к её оригиналу. `inChatId` — чат, в котором живёт ответ:
   * у облачка островка это чат оригинала, и прыгать надо туда.
   */
  openQuote: (quote: QuotedMessage, inChatId?: string) => void;
  /** Чат целиком — плашка островка: откуда пересылали. */
  openChat: (chatId: string) => void;
  /** Сообщение в его чате — «из <чат>» и «Перейти к оригиналу» у облачка островка. */
  openOriginal: (message: { id: string; chatId: string; createdAt: string }) => void;
  /** Пересланный комментарий — в его чат: шит с ним и сообщение под шитом. */
  openComment: (chatId: string, focus: CommentFocus) => void;
};

type Options = {
  jump: Jump;
  /** История и чат загружены — можно прыгать. */
  isHistoryReady: boolean;
  /** Экран наверху стека: шит рисует только он. */
  isFocused: boolean;
  /** Открыть шит комментария на этом экране и подвинуть переписку к сообщению. */
  focusComment: (focus: CommentFocus) => void;
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
 * и «из <чат>» — в другой, по пересланному комментарию — в его чат с шитом.
 * Приход в чат с `jumpKey` в адресе — это переход с другой стороны: как
 * только история загружена, экран прыгает к строке или открывает шит.
 */
export function useQuoteNavigation(
  chatId: string,
  { jump, isHistoryReady, isFocused, focusComment }: Options,
): QuoteNavigation {
  const router = useRouter();
  const navigation = useNavigation();
  const { jumpTo, jumpAt, jumpKey, comments, comment } = useLocalSearchParams<{
    jumpTo?: string;
    jumpAt?: string;
    jumpKey?: string;
    comments?: string;
    comment?: string;
  }>();
  const handledJumpRef = useRef<string | null>(null);

  // Ключ, а не id сообщения: к тому же оригиналу могут прийти и второй раз,
  // вернувшись в уже открытый чат.
  const requestedJump = jumpKey ?? jumpTo;

  useEffect(() => {
    if (!isHistoryReady || !requestedJump || handledJumpRef.current === requestedJump) return;

    if (comments && comment) {
      // Шит рисует только экран наверху: при возврате к чату ниже в стеке
      // адрес меняется раньше, чем он снова в фокусе.
      if (!isFocused) return;

      handledJumpRef.current = requestedJump;
      focusComment({
        messageId: comments,
        commentId: comment,
        target: jumpTo && jumpAt ? { key: jumpTo, createdAt: jumpAt } : null,
      });
      return;
    }

    if (!jumpTo || !jumpAt) return;

    handledJumpRef.current = requestedJump;
    void jump(jumpTo, jumpAt).then(reportJump);
  }, [
    comment,
    comments,
    focusComment,
    isFocused,
    isHistoryReady,
    jump,
    jumpAt,
    jumpTo,
    requestedJump,
  ]);

  /** В другой чат: к уже открытому ниже в стеке экрану, а не вторым экземпляром. */
  const goToChat = useCallback(
    (targetChatId: string, target: JumpTarget | null, focus?: CommentFocus) => {
      if (targetChatId === chatId) {
        if (focus) focusComment(focus);
        else if (target) void jump(target.key, target.createdAt).then(reportJump);
        return;
      }

      const to = focus ? focus.target : target;
      // Шит открывается по ключу перехода, даже когда прыгать некуда.
      const params = {
        chatId: targetChatId,
        ...(to ? { jumpTo: to.key, jumpAt: to.createdAt } : {}),
        ...(focus ? { comments: focus.messageId, comment: focus.commentId } : {}),
        ...(to || focus ? { jumpKey: String(Date.now()) } : {}),
      };

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
        if (to || focus) {
          // Параметры сливаются с прежними: прыжок и шит прошлого перехода
          // стираются явно, иначе экран исполнил бы их снова.
          navigation.dispatch({
            type: 'SET_PARAMS',
            payload: {
              params: {
                jumpTo: undefined,
                jumpAt: undefined,
                comments: undefined,
                comment: undefined,
                ...params,
              },
            },
            source: state.routes[index].key,
          });
        }
        navigation.dispatch({ type: 'POP', payload: { count: state.index - index } });
        return;
      }

      router.push({ pathname: '/chats/[chatId]', params });
    },
    [chatId, focusComment, jump, navigation, router],
  );

  const openQuote = useCallback(
    (quote: QuotedMessage, inChatId: string = chatId) => {
      // По удалённому оригиналу тап ничего не делает.
      if (quote.state !== 'live') return;

      goToChat(inChatId, quoteTarget(quote));
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

  const openComment = useCallback(
    (targetChatId: string, focus: CommentFocus) => goToChat(targetChatId, null, focus),
    [goToChat],
  );

  return { openQuote, openChat, openOriginal, openComment };
}
