import { closeComments } from '@/features/interactions/comments/commentsPanelStore';
import { nextJumpKey } from '@/features/chats/jumpParams';

export type OpenPopViewerOptions = {
  /**
   * Сразу с открытыми комментариями к этому попу и этим комментарием наверху
   * (подсвечен, у ответа — открыта его ветка). Пришли по пересланному.
   */
  focusCommentId?: string;
  /** Известный корень ответа позволяет открыть нужное окно без перехода через список. */
  focusRootId?: string;
  requestId?: string;
  /** Откуда открыли — точка входа показа в журнале рекомендаций. */
  entry?: PopViewerEntry;
};

/** Откуда открыт просмотр попсов канала. */
export type PopViewerEntry = 'channel_grid' | 'post' | 'comment_link';

/**
 * Открыть просмотр попсов канала с этого попа. Из сетки, поста и пересланного
 * поста — одинаково. Роутер подгружается при вызове: облачко сообщения, откуда
 * это вызывается, рисуется и там, где навигатора нет (тесты, копия в меню).
 */
export function openPopViewer(
  channelId: string,
  popId: string,
  { focusCommentId, focusRootId, requestId, entry }: OpenPopViewerOptions = {},
) {
  const from = entry ?? (focusCommentId ? 'comment_link' : 'post');
  const params = focusCommentId
    ? {
        channelId,
        start: popId,
        comments: '1',
        comment: focusCommentId,
        ...(focusRootId ? { commentRoot: focusRootId } : {}),
        commentKey: requestId ?? nextJumpKey(),
        from,
      }
    : { channelId, start: popId, from };

  // Открытый шит предыдущего экрана не должен перекрыть новый просмотр.
  closeComments();

  void import('expo-router').then(({ router }) =>
    router.push({ pathname: '/pops/[channelId]', params }),
  );
}
