import { useEffect } from 'react';

import { PanelWindow } from './PanelWindow';

import { setCommentsKeyboardWindowOpen } from '@/features/chats/composerKeyboard';
import {
  closeComments,
  useCommentsPanelTarget,
} from '@/features/interactions/comments/commentsPanelStore';

export {
  closeComments,
  commentsEntry,
  openComments,
} from '@/features/interactions/comments/commentsPanelStore';

export type CommentsPanelProps = {
  /** Где кончается шапка экрана: панель встаёт под ней, шапка остаётся видна. */
  topInset: number;
  /** Тап по аватару или имени — профиль человека. Панель перед этим закрывается. */
  onOpenPerson: (userId: string) => void;
};

/**
 * Панель комментариев экрана. Открывается функцией `openComments(messageId)`
 * откуда угодно; окно живёт, пока панель открыта, и рождается заново для
 * каждого сообщения.
 */
export function CommentsPanel({ topInset, onOpenPerson }: CommentsPanelProps) {
  const target = useCommentsPanelTarget();
  const open = target !== null;

  // Пока панель открыта, клавиатура под ней — её поля, а не поля переписки.
  useEffect(() => setCommentsKeyboardWindowOpen(open), [open]);

  // Уход с экрана закрывает панель: следующий экран застанет её закрытой.
  useEffect(() => () => closeComments(), []);

  if (!target) return null;

  return (
    <PanelWindow
      key={target.messageId}
      target={target}
      topInset={topInset}
      onOpenPerson={onOpenPerson}
    />
  );
}
