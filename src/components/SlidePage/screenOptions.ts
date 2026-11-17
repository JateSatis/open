/**
 * Опции маршрута-страницы (`SlidePage`): без шапки стека, прозрачный поверх
 * предыдущего экрана и без анимации стека — въезд и уход ведёт сама страница.
 */
export const SLIDE_PAGE = {
  headerShown: false,
  presentation: 'transparentModal',
  animation: 'none',
  gestureEnabled: false,
} as const;
