import { useCallback, useRef } from 'react';

import type { Message } from '@/api/chats';
import { locateFragment, type FragmentWhereabouts } from '@/api/fragments';
import { requestFragmentJump } from '@/features/chats/fragments/fragmentJump';
import { exitFragmentMode } from '@/features/chats/fragments/fragmentStore';
import type { CommentItem } from '@/features/interactions/comments/commentItem';
import {
  getCommentsPanelTarget,
  type CommentsPanelTarget,
} from '@/features/interactions/comments/commentsPanelStore';
import { showNotice } from '@/features/notifications/alertsStore';
import { withDeadline } from '@/lib/deadline';

/**
 * Дольше не ждём ответа базы: человек тапнул и ждёт движения. Без ответа —
 * по тому, что знает панель.
 */
const LOCATE_DEADLINE_MS = 3000;

/**
 * Где фрагмент, если спросить базу не вышло (нет сети): по тому, что уже
 * знает панель, — цитате комментария и сообщению под шитом.
 */
function fromCache(item: CommentItem, message: Message | null): FragmentWhereabouts | null {
  const quote = item.fragmentQuote;

  if (!quote || !message) return null;

  return {
    state: 'live',
    start: quote.start,
    end: quote.end,
    lost: quote.lost,
    messageCreatedAt: message.createdAt,
  };
}

/**
 * Та же панель: боковая панель фрагмента получает копию цели, поэтому
 * сравнение — по тому, что панель показывает, а не по ссылке.
 */
function isSamePanel(current: CommentsPanelTarget | null, target: CommentsPanelTarget): boolean {
  return (
    current !== null &&
    current.subject.id === target.subject.id &&
    current.rowKey === target.rowKey &&
    current.fragment?.key === target.fragment?.key
  );
}

/**
 * Тап по цитате фрагмента над комментарием: панель закрывается, сообщение
 * выходит из режима фрагментов, переписка под панелью едет к нему и
 * подсвечивает кусок (`useFragmentJump`). Где кусок сейчас, спрашиваем у базы:
 * пока панель была открыта, сообщение могли переписать или удалить. Удалено —
 * панель остаётся, идти некуда.
 */
export function useGoToFragment(
  target: CommentsPanelTarget,
  message: Message | null,
  close: () => void,
  /** Экран переписки под панелью — только он выполнит переход. */
  hostChatId: string | undefined,
) {
  const busy = useRef(false);

  return useCallback(
    async (item: CommentItem) => {
      const quote = item.fragmentQuote;

      if (!item.fragmentId || busy.current) return;

      // Фрагмент не читается — его сообщение удалено вместе с текстом.
      if (!quote) {
        showNotice('Сообщение удалено');
        return;
      }

      busy.current = true;

      const messageId = target.subject.id;
      const where = await withDeadline(
        locateFragment(item.fragmentId, messageId),
        LOCATE_DEADLINE_MS,
      ).catch(() => fromCache(item, message));

      busy.current = false;

      // Пока спрашивали, панель закрыли или открыли другую — переход уже не к месту.
      if (!isSamePanel(getCommentsPanelTarget(), target)) return;

      if (where?.state === 'deleted') {
        showNotice('Сообщение удалено');
        return;
      }

      if (!where || where.state === 'missing') {
        showNotice('Не удалось найти сообщение', 'error');
        return;
      }

      requestFragmentJump({
        hostChatId,
        messageId,
        chatId: target.chatId,
        rowKey: target.rowKey,
        createdAt: where.messageCreatedAt,
        // Плашка всегда показывает цитату, с которой комментировали; в тексте
        // ищется она же.
        text: quote.text,
        start: where.start,
        end: where.end,
        lost: where.lost,
      });
      exitFragmentMode();
      close();
    },
    [close, hostChatId, message, target],
  );
}
