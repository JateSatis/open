export type OpenPopViewerOptions = {
  /**
   * Сразу с открытыми комментариями к этому попу и этим комментарием наверху
   * (подсвечен, у ответа — открыта его ветка). Пришли по пересланному.
   */
  focusCommentId?: string;
};

/**
 * Открыть просмотр попсов канала с этого попа. Из сетки, поста и пересланного
 * поста — одинаково. Роутер подгружается при вызове: облачко сообщения, откуда
 * это вызывается, рисуется и там, где навигатора нет (тесты, копия в меню).
 */
export function openPopViewer(
  channelId: string,
  popId: string,
  { focusCommentId }: OpenPopViewerOptions = {},
) {
  const params = focusCommentId
    ? { channelId, start: popId, comments: '1', comment: focusCommentId }
    : { channelId, start: popId };

  void import('expo-router').then(({ router }) =>
    router.push({ pathname: '/pops/[channelId]', params }),
  );
}
