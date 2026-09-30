import * as Clipboard from 'expo-clipboard';
import { useCallback } from 'react';

import { confirm } from '@/components/ConfirmDialog';
import { formatMessagesForCopy } from '@/features/chats/copyMessages';
import { anchorOf, contentOf, islandItemKey, type BubbleRow } from '@/features/chats/islands/rows';
import { messagesCount } from '@/features/chats/messageQuote';
import {
  isLocalMessage,
  type IslandActionId,
  type MessageActionId,
  type SelectionActionId,
} from '@/features/chats/messageActions';
import type { ChatMessage } from '@/features/chats/messages/types';
import type { MessageSelection } from '@/features/chats/useMessageSelection';
import type { PinnedMessagesState } from '@/features/chats/usePinnedMessages';
import { showNotice } from '@/features/notifications/alertsStore';
import { isNetworkError } from '@/lib/network';

function failure(action: string, cause: unknown): string {
  return isNetworkError(cause) ? `${action}: нет связи` : action;
}

async function copyText(text: string) {
  await Clipboard.setStringAsync(text);
  showNotice('Скопировано');
}

type Options = {
  currentUserId: string | null;
  selection: MessageSelection;
  pins: Pick<PinnedMessagesState, 'pin' | 'unpin'>;
  retry: (localId: string) => void;
  discard: (localId: string) => void;
  deleteMessages: (messageIds: string[]) => Promise<void>;
  removeFromIsland: (forwardId: string, messageIds: string[]) => Promise<void>;
  authorName: (authorId: string | null) => string;
  /** Ответить: облачка встают в плашку над полем ввода. */
  reply: (rows: BubbleRow[]) => void;
  /** Переслать: дальше — выбор чата. */
  forward: (rows: BubbleRow[]) => void;
  /** Изменить: поле ввода переходит в режим правки этого сообщения. */
  edit: (message: ChatMessage) => void;
  /** Оригинал облачка островка — в его чате. */
  openOriginal: (message: ChatMessage) => void;
};

export type MessageActionHandlers = {
  runMessageAction: (id: MessageActionId, row: BubbleRow) => void;
  runSelectionAction: (id: SelectionActionId) => void;
  runIslandAction: (id: IslandActionId, island: ChatMessage) => void;
};

/** Кто автор облачка — у облачка островка имя из оригинала, его нет среди участников. */
function namesOf(rows: BubbleRow[], authorName: (authorId: string | null) => string) {
  const known = new Map<string, string>();

  for (const row of rows) {
    const original = row.type === 'island-item' ? row.item.original : null;

    if (original?.authorId && original.authorName) known.set(original.authorId, original.authorName);
  }

  return (authorId: string | null) => (authorId && known.get(authorId)) || authorName(authorId);
}

/** Что делает каждый пункт меню, каждая кнопка панели выбора и пункт плашки островка. */
export function useMessageActionHandlers({
  currentUserId,
  selection,
  pins,
  retry,
  discard,
  deleteMessages,
  removeFromIsland,
  authorName,
  reply,
  forward,
  edit,
  openOriginal,
}: Options): MessageActionHandlers {
  /**
   * Удаляет у всех: свои сообщения — функцией удаления, облачка своих
   * островков — убирает из островков. Оригиналы в островках не трогаются.
   */
  const removeForEveryone = useCallback(
    async (rows: BubbleRow[]) => {
      const islandOnly = rows.every((row) => row.type === 'island-item');
      const confirmed = await confirm({
        title: islandOnly
          ? rows.length === 1
            ? 'Убрать из пересылки?'
            : `Убрать из пересылки ${messagesCount(rows.length)}?`
          : rows.length === 1
            ? 'Удалить сообщение?'
            : `Удалить ${messagesCount(rows.length)}?`,
        message: islandOnly
          ? 'Их не будет в этом чате ни у кого. В исходных чатах сообщения останутся.'
          : rows.length === 1
            ? 'Оно исчезнет у всех.'
            : 'Они исчезнут у всех.',
        confirmLabel: islandOnly ? 'Убрать' : 'Удалить',
        cancelLabel: 'Отмена',
        destructive: true,
      });

      if (!confirmed) return;

      selection.clear();

      const own = rows.flatMap((row) => (row.type === 'message' ? [row.message.id] : []));
      const byIsland = new Map<string, string[]>();

      for (const row of rows) {
        if (row.type !== 'island-item') continue;

        byIsland.set(row.island.id, [...(byIsland.get(row.island.id) ?? []), row.item.messageId]);
      }

      try {
        await Promise.all([
          own.length > 0 ? deleteMessages(own) : Promise.resolve(),
          ...[...byIsland].map(([forwardId, ids]) => removeFromIsland(forwardId, ids)),
        ]);
      } catch (cause) {
        showNotice(
          failure(
            rows.length === 1 ? 'Не удалось удалить сообщение' : 'Не удалось удалить сообщения',
            cause,
          ),
          'error',
        );
      }
    },
    [deleteMessages, removeFromIsland, selection],
  );

  const runMessageAction = useCallback(
    (id: MessageActionId, row: BubbleRow) => {
      const message = contentOf(row);

      switch (id) {
        case 'retry':
          if (message?.localId) retry(message.localId);
          return;
        case 'reply':
          reply([row]);
          return;
        case 'forward':
          forward([row]);
          return;
        case 'edit':
          if (message) edit(message);
          return;
        case 'copy':
          void copyText(message?.text ?? '');
          return;
        case 'open_original':
          if (message) openOriginal(message);
          return;
        case 'pin':
          if (!message) return;

          pins.pin(message, anchorOf(row)).catch((cause: unknown) =>
            showNotice(failure('Не удалось закрепить сообщение', cause), 'error'),
          );
          return;
        case 'unpin':
          if (!message) return;

          pins.unpin(message.id).catch((cause: unknown) =>
            showNotice(failure('Не удалось открепить сообщение', cause), 'error'),
          );
          return;
        case 'select':
          selection.start(row.key);
          return;
        case 'remove_from_island':
          void removeForEveryone([row]);
          return;
        case 'delete':
          if (message && isLocalMessage(message)) {
            // Неотправленного на сервере нет — и спрашивать «исчезнет у всех» не о чем.
            if (message.localId) discard(message.localId);
            return;
          }

          void removeForEveryone([row]);
          return;
      }
    },
    [discard, edit, forward, openOriginal, pins, removeForEveryone, reply, retry, selection],
  );

  const runSelectionAction = useCallback(
    (id: SelectionActionId) => {
      const rows = selection.selected;

      switch (id) {
        case 'reply':
          // Выбор закрывается раньше плашки: поле ввода на время выбора спрятано.
          reply(rows);
          selection.clear();
          return;
        case 'forward':
          forward(rows);
          selection.clear();
          return;
        case 'copy':
          void copyText(
            formatMessagesForCopy(
              rows.flatMap((row) => contentOf(row) ?? []),
              namesOf(rows, authorName),
            ),
          );
          selection.clear();
          return;
        case 'delete':
          void removeForEveryone(rows);
          return;
      }
    },
    [authorName, forward, removeForEveryone, reply, selection],
  );

  const runIslandAction = useCallback(
    (id: IslandActionId, island: ChatMessage) => {
      switch (id) {
        case 'retry':
          if (island.localId) retry(island.localId);
          return;
        case 'select_all':
          // Заглушку удалённого отмечает только переславший — чтобы убрать её.
          selection.start(
            (island.forward?.items ?? [])
              .filter((item) => item.original !== null || island.authorId === currentUserId)
              .map((item) => islandItemKey(island.id, item.messageId)),
          );
          return;
        case 'delete_island':
          if (isLocalMessage(island)) {
            if (island.localId) discard(island.localId);
            return;
          }

          void confirm({
            title: 'Удалить пересылку?',
            message: 'Она исчезнет из этого чата у всех. В исходных чатах сообщения останутся.',
            confirmLabel: 'Удалить',
            cancelLabel: 'Отмена',
            destructive: true,
          }).then((confirmed) => {
            if (!confirmed) return;

            deleteMessages([island.id]).catch((cause: unknown) =>
              showNotice(failure('Не удалось удалить пересылку', cause), 'error'),
            );
          });
          return;
      }
    },
    [currentUserId, deleteMessages, discard, retry, selection],
  );

  return { runMessageAction, runSelectionAction, runIslandAction };
}
