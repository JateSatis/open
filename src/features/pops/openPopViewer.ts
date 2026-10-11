/**
 * Открыть просмотр попсов канала с этого попа. Из сетки, поста и пересланного
 * поста — одинаково. Роутер подгружается при вызове: облачко сообщения, откуда
 * это вызывается, рисуется и там, где навигатора нет (тесты, копия в меню).
 */
export function openPopViewer(channelId: string, popId: string) {
  void import('expo-router').then(({ router }) =>
    router.push({ pathname: '/pops/[channelId]', params: { channelId, start: popId } }),
  );
}
