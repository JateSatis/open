import { useIsFocused } from 'expo-router';
import { useEffect, useRef } from 'react';

import { PanelWindow } from './PanelWindow';

import { setCommentsKeyboardWindowOpen } from '@/features/chats/composerKeyboard';
import {
  closeComments,
  getCommentsPanelTarget,
  useCommentsPanelTarget,
  type CommentsPanelTarget,
} from '@/features/interactions/comments/commentsPanelStore';

export {
  closeComments,
  commentsEntry,
  openComments,
} from '@/features/interactions/comments/commentsPanelStore';

export type CommentsPanelProps = {
  /** Тап по аватару или имени — профиль человека. Панель перед этим закрывается. */
  onOpenPerson: (userId: string) => void;
  /**
   * Чат экрана, на котором смонтирована панель, — он лежит под выбором чата
   * при пересылке. Не чат сообщения: у облачка островка это чат оригинала.
   * Без чата под панелью — не передаётся.
   */
  hostChatId?: string;
};

/**
 * Панель комментариев экрана. Открывается функцией `openComments(messageId)`
 * откуда угодно; окно живёт, пока панель открыта, и рождается заново для
 * каждого сообщения.
 */
export function CommentsPanel({ onOpenPerson, hostChatId }: CommentsPanelProps) {
  // Стор панели общий, а экранов с панелью в стеке бывает несколько (чат,
  // открытый из чата): окно рисует только экран в фокусе. Иначе под
  // закрывающейся панелью на миг показывался её двойник.
  const isFocused = useIsFocused();
  const target = useCommentsPanelTarget();
  const open = target !== null && isFocused;

  // Пока панель открыта, клавиатура под ней — её поля, а не поля переписки.
  useEffect(() => setCommentsKeyboardWindowOpen(open), [open]);

  // Уход с экрана закрывает панель, которую показывал он: следующий экран
  // застанет её закрытой. Чужую — нет: при возврате к чату ниже в стеке тот
  // открывает свою панель раньше, чем снимаемый экран размонтируется.
  const shownRef = useRef<CommentsPanelTarget | null>(null);

  useEffect(() => {
    if (open) shownRef.current = target;
  }, [open, target]);

  useEffect(
    () => () => {
      const current = getCommentsPanelTarget();

      if (current === null || current === shownRef.current) closeComments();
    },
    [],
  );

  if (!target || !open) return null;

  return (
    <PanelWindow
      key={target.messageId}
      target={target}
      onOpenPerson={onOpenPerson}
      hostChatId={hostChatId}
    />
  );
}
