import * as Clipboard from 'expo-clipboard';
import { useCallback } from 'react';

import { confirm } from '@/components/ConfirmDialog';
import { formatMessagesForCopy } from '@/features/chats/copyMessages';
import {
  isLocalMessage,
  type MessageActionId,
  type SelectionActionId,
} from '@/features/chats/messageActions';
import type { ChatMessage } from '@/features/chats/messages/types';
import type { MessageSelection } from '@/features/chats/useMessageSelection';
import type { PinnedMessagesState } from '@/features/chats/usePinnedMessages';
import { showNotice } from '@/features/notifications/alertsStore';
import { isNetworkError } from '@/lib/network';

/** «1 сообщение», «3 сообщения», «11 сообщений». */
export function messagesCount(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? 'сообщение'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'сообщения'
        : 'сообщений';

  return `${n} ${word}`;
}

function failure(action: string, cause: unknown): string {
  return isNetworkError(cause) ? `${action}: нет связи` : action;
}

async function copyText(text: string) {
  await Clipboard.setStringAsync(text);
  showNotice('Скопировано');
}

type Options = {
  selection: MessageSelection;
  pins: Pick<PinnedMessagesState, 'pin' | 'unpin'>;
  retry: (localId: string) => void;
  discard: (localId: string) => void;
  deleteMessages: (messageIds: string[]) => Promise<void>;
  authorName: (authorId: string | null) => string;
};

export type MessageActionHandlers = {
  runMessageAction: (id: MessageActionId, message: ChatMessage) => void;
  runSelectionAction: (id: SelectionActionId) => void;
};

/** Что делает каждый пункт меню и каждая кнопка панели выбора. */
export function useMessageActionHandlers({
  selection,
  pins,
  retry,
  discard,
  deleteMessages,
  authorName,
}: Options): MessageActionHandlers {
  const removeForEveryone = useCallback(
    async (messageIds: string[]) => {
      const confirmed = await confirm({
        title:
          messageIds.length === 1
            ? 'Удалить сообщение?'
            : `Удалить ${messagesCount(messageIds.length)}?`,
        message: messageIds.length === 1 ? 'Оно исчезнет у всех.' : 'Они исчезнут у всех.',
        confirmLabel: 'Удалить',
        cancelLabel: 'Отмена',
        destructive: true,
      });

      if (!confirmed) return;

      selection.clear();

      try {
        await deleteMessages(messageIds);
      } catch (cause) {
        showNotice(
          failure(
            messageIds.length === 1 ? 'Не удалось удалить сообщение' : 'Не удалось удалить сообщения',
            cause,
          ),
          'error',
        );
      }
    },
    [deleteMessages, selection],
  );

  const runMessageAction = useCallback(
    (id: MessageActionId, message: ChatMessage) => {
      switch (id) {
        case 'retry':
          if (message.localId) retry(message.localId);
          return;
        case 'copy':
          void copyText(message.text ?? '');
          return;
        case 'pin':
          pins.pin(message).catch((cause: unknown) =>
            showNotice(failure('Не удалось закрепить сообщение', cause), 'error'),
          );
          return;
        case 'unpin':
          pins.unpin(message.id).catch((cause: unknown) =>
            showNotice(failure('Не удалось открепить сообщение', cause), 'error'),
          );
          return;
        case 'select':
          selection.start(message.id);
          return;
        case 'delete':
          if (isLocalMessage(message)) {
            // Неотправленного на сервере нет — и спрашивать «исчезнет у всех» не о чем.
            if (message.localId) discard(message.localId);
            return;
          }

          void removeForEveryone([message.id]);
          return;
      }
    },
    [discard, pins, removeForEveryone, retry, selection],
  );

  const runSelectionAction = useCallback(
    (id: SelectionActionId) => {
      switch (id) {
        case 'copy':
          void copyText(formatMessagesForCopy(selection.selected, authorName));
          selection.clear();
          return;
        case 'delete':
          void removeForEveryone(selection.selected.map((message) => message.id));
          return;
      }
    },
    [authorName, removeForEveryone, selection],
  );

  return { runMessageAction, runSelectionAction };
}
