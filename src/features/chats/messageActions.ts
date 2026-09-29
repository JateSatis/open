// Что можно сделать с сообщением — одним списком, декларативно. Новое действие
// (ответить, переслать, изменить) — это одна запись здесь и один обработчик
// там, где меню открывают; раскладку меню и панели выбора это не трогает.
//
// Видимость пункта — вежливость интерфейса. Права всегда проверяет сервер:
// скрытая кнопка лишь не предлагает того, что он всё равно отвергнет.

import { MAX_FORWARD, MAX_QUOTES } from '@/features/chats/messageQuote';
import type { ChatMessage } from '@/features/chats/messages/types';

/** Всё, от чего зависит, какие пункты показать у конкретного сообщения. */
export type MessageActionContext = {
  message: ChatMessage;
  /** Сообщение моё. */
  isOwn: boolean;
  /** Я участник чата, а не посетитель. */
  isMember: boolean;
  isPinned: boolean;
};

export type MessageActionId =
  | 'retry'
  | 'reply'
  | 'copy'
  | 'pin'
  | 'unpin'
  | 'forward'
  | 'select'
  | 'delete';

export type MessageAction = {
  id: MessageActionId;
  label: string;
  /** Красным — разрушительное действие. */
  destructive?: boolean;
  isVisible: (context: MessageActionContext) => boolean;
};

/** Ещё не подтверждено сервером: отправляется или упало. */
export function isLocalMessage(message: ChatMessage): boolean {
  return message.status !== 'sent';
}

export function hasCopyableText(message: ChatMessage): boolean {
  return Boolean(message.text?.trim());
}

/** Пункты меню в том порядке, в котором их видит человек. */
export const MESSAGE_ACTIONS: readonly MessageAction[] = [
  {
    id: 'retry',
    label: 'Повторить',
    isVisible: ({ message }) => message.status === 'failed',
  },
  {
    id: 'reply',
    label: 'Ответить',
    // Ответ — это отправка: писать в чат может только участник.
    isVisible: ({ message, isMember }) => isMember && !isLocalMessage(message),
  },
  {
    id: 'copy',
    label: 'Копировать',
    isVisible: ({ message }) => !isLocalMessage(message) && hasCopyableText(message),
  },
  {
    id: 'pin',
    label: 'Закрепить',
    isVisible: ({ message, isMember, isPinned }) =>
      isMember && !isPinned && !isLocalMessage(message),
  },
  {
    id: 'unpin',
    label: 'Открепить',
    isVisible: ({ message, isMember, isPinned }) =>
      isMember && isPinned && !isLocalMessage(message),
  },
  {
    id: 'forward',
    label: 'Переслать',
    // Переслать чужую переписку в свой чат может и посетитель — так она и
    // расходится.
    isVisible: ({ message }) => !isLocalMessage(message),
  },
  {
    id: 'select',
    label: 'Выбрать',
    isVisible: ({ message }) => !isLocalMessage(message),
  },
  {
    id: 'delete',
    label: 'Удалить',
    destructive: true,
    // Своё неотправленное удаляется только у себя — на сервере его нет. Своё
    // отправленное — для всех, и тогда нужно ещё быть автором (это проверит
    // и база).
    isVisible: ({ isOwn }) => isOwn,
  },
];

export function visibleMessageActions(context: MessageActionContext): MessageAction[] {
  return MESSAGE_ACTIONS.filter((action) => action.isVisible(context));
}

/** Что известно о выбранных сообщениях, чтобы решить, какие кнопки панели доступны. */
export type SelectionActionContext = {
  selected: ChatMessage[];
  currentUserId: string | null;
  isMember: boolean;
};

export type SelectionActionId = 'reply' | 'forward' | 'copy' | 'delete';

export type SelectionAction = {
  id: SelectionActionId;
  label: string;
  destructive?: boolean;
  isEnabled: (context: SelectionActionContext) => boolean;
};

/** Кнопки панели внизу в режиме выбора — слева направо. */
export const SELECTION_ACTIONS: readonly SelectionAction[] = [
  {
    id: 'reply',
    label: 'Ответить',
    // У посетителя кнопка есть, но неактивна — как «Удалить» у чужих.
    isEnabled: ({ selected, isMember }) =>
      isMember && selected.length > 0 && selected.length <= MAX_QUOTES,
  },
  {
    id: 'forward',
    label: 'Переслать',
    isEnabled: ({ selected }) => selected.length > 0 && selected.length <= MAX_FORWARD,
  },
  {
    id: 'copy',
    label: 'Копировать',
    isEnabled: ({ selected }) => selected.some(hasCopyableText),
  },
  {
    id: 'delete',
    label: 'Удалить',
    destructive: true,
    // Хоть одно чужое — удалить пачку нельзя: база отвергла бы её целиком.
    isEnabled: ({ selected, currentUserId }) =>
      selected.length > 0 &&
      currentUserId !== null &&
      selected.every((message) => message.authorId === currentUserId),
  },
];
