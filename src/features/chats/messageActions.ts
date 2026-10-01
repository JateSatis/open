// Что можно сделать с сообщением — одним списком, декларативно. Новое действие
// (ответить, переслать, изменить) — это одна запись здесь и один обработчик
// там, где меню открывают; раскладку меню и панели выбора это не трогает.
//
// Видимость пункта — вежливость интерфейса. Права всегда проверяет сервер:
// скрытая кнопка лишь не предлагает того, что он всё равно отвергнет.

import { contentOf, type BubbleRow } from '@/features/chats/islands/rows';
import { MAX_FORWARD, MAX_QUOTES } from '@/features/chats/messageQuote';
import type { ChatMessage } from '@/features/chats/messages/types';

/** Всё, от чего зависит, какие пункты показать у конкретного сообщения. */
export type MessageActionContext = {
  /** Сообщение облачка — у облачка островка это оригинал. */
  message: ChatMessage;
  /** Сообщение моё. */
  isOwn: boolean;
  /** Я участник чата, а не посетитель. */
  isMember: boolean;
  isPinned: boolean;
  /**
   * Облачко стоит в островке: действия — над оригиналом, правки нет, а
   * «удалить» — убрать из островка, и только переславшему.
   */
  island?: { isMine: boolean } | null;
};

export type MessageActionId =
  | 'retry'
  | 'reply'
  | 'copy'
  | 'edit'
  | 'pin'
  | 'unpin'
  | 'forward'
  | 'open_original'
  | 'select'
  | 'delete'
  | 'remove_from_island';

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

/**
 * Правится только подтверждённое сервером и не сохраняющее другую правку.
 * Системное — не слова человека, островок — не сообщение: их база править и
 * не даст.
 */
export function isEditable(message: ChatMessage): boolean {
  return (
    !isLocalMessage(message) &&
    !message.editStatus &&
    (message.kind === 'text' || message.kind === 'media' || message.kind === 'voice')
  );
}

/**
 * На сообщение можно поставить реакцию — и участнику, и посетителю. Не на
 * неподтверждённое сервером (его там ещё нет), не на системное (это не слова
 * человека) и не на островок: реакции — у оригиналов внутри. Своё
 * отправленное — можно, как в Telegram.
 */
export function canReactTo(message: ChatMessage): boolean {
  return !isLocalMessage(message) && message.kind !== 'system' && message.kind !== 'forward';
}

/**
 * У сообщения есть комментарии — у каждого отправленного, во всех чатах,
 * всегда. Кроме системного, островка (комментируют оригиналы внутри) и
 * неподтверждённого сервером: база такие комментарии и не примет.
 */
export function canCommentOn(message: ChatMessage): boolean {
  return !isLocalMessage(message) && message.kind !== 'system' && message.kind !== 'forward';
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
    id: 'edit',
    label: 'Изменить',
    // Оригинал правят там, где он живёт, — в островке его только показывают.
    isVisible: ({ message, isOwn, isMember, island }) =>
      !island && isMember && isOwn && isEditable(message),
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
    id: 'open_original',
    label: 'Перейти к оригиналу',
    isVisible: ({ island }) => Boolean(island),
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
    // и база). Оригинал из островка отсюда не удаляется никогда — только в
    // своём чате его автором.
    isVisible: ({ isOwn, island }) => !island && isOwn,
  },
  {
    id: 'remove_from_island',
    label: 'Убрать из пересылки',
    destructive: true,
    isVisible: ({ island }) => Boolean(island?.isMine),
  },
];

export function visibleMessageActions(context: MessageActionContext): MessageAction[] {
  return MESSAGE_ACTIONS.filter((action) => action.isVisible(context));
}

/** Пункты облачка-заглушки: оригинал удалён, остаётся только убрать его из своего островка. */
export function deletedOriginalActions(isMine: boolean): MessageAction[] {
  if (!isMine) return [];

  return MESSAGE_ACTIONS.filter(
    (action) => action.id === 'select' || action.id === 'remove_from_island',
  );
}

export type IslandActionId = 'open_source' | 'retry' | 'select_all' | 'delete_island';

export type IslandAction = { id: IslandActionId; label: string; destructive?: boolean };

/**
 * Пункты островка целиком — по тапу на плашку, как меню облачка. Реакций и
 * комментариев здесь нет: островок не сообщение. Первым — переход в чат,
 * откуда переслали: раньше это и был тап по плашке.
 */
export function islandActions(island: ChatMessage, isMine: boolean): IslandAction[] {
  const actions: IslandAction[] = [];
  const source = island.forward?.sourceChat;

  if (source) actions.push({ id: 'open_source', label: `Перейти в «${source.name}»` });

  if (island.status === 'failed') actions.push({ id: 'retry', label: 'Повторить' });
  if (!isLocalMessage(island)) actions.push({ id: 'select_all', label: 'Выбрать все' });
  if (isMine) actions.push({ id: 'delete_island', label: 'Удалить пересылку', destructive: true });

  return actions;
}

/** Что известно о выбранных сообщениях, чтобы решить, какие кнопки панели доступны. */
export type SelectionActionContext = {
  /** Выбранные облачка — в порядке переписки. */
  selected: BubbleRow[];
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

/** У всех выбранных есть сообщение: заглушку удалённого не процитировать и не переслать. */
function allHaveContent(selected: BubbleRow[]): boolean {
  return selected.every((row) => contentOf(row) !== null);
}

/** Удалить у всех можно своё сообщение и облачко своего островка — из островка. */
function isRemovableBy(row: BubbleRow, currentUserId: string): boolean {
  return row.type === 'message'
    ? row.message.authorId === currentUserId
    : row.island.authorId === currentUserId && !isLocalMessage(row.island);
}

/** Кнопки панели внизу в режиме выбора — слева направо. */
export const SELECTION_ACTIONS: readonly SelectionAction[] = [
  {
    id: 'reply',
    label: 'Ответить',
    // У посетителя кнопка есть, но неактивна — как «Удалить» у чужих.
    isEnabled: ({ selected, isMember }) =>
      isMember && selected.length > 0 && selected.length <= MAX_QUOTES && allHaveContent(selected),
  },
  {
    id: 'forward',
    label: 'Переслать',
    isEnabled: ({ selected }) =>
      selected.length > 0 && selected.length <= MAX_FORWARD && allHaveContent(selected),
  },
  {
    id: 'copy',
    label: 'Копировать',
    isEnabled: ({ selected }) =>
      selected.some((row) => {
        const content = contentOf(row);

        return content !== null && hasCopyableText(content);
      }),
  },
  {
    id: 'delete',
    label: 'Удалить',
    destructive: true,
    // Хоть одно чужое — удалить пачку нельзя: база отвергла бы её целиком.
    isEnabled: ({ selected, currentUserId }) =>
      selected.length > 0 &&
      currentUserId !== null &&
      selected.every((row) => isRemovableBy(row, currentUserId)),
  },
];
