import { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  commentsSheetOpen,
  commentsSheetTop,
} from '@/features/interactions/comments/commentsLift';

/**
 * Видео страницы и интерфейс поверх него, пока открыты комментарии к попу.
 * Видео уменьшается целиком в область над шитом — от статус-бара до верха
 * шита — и стоит в ней по центру; интерфейс (подпись, колонка, полоса)
 * гаснет. Всё — по ходу шита на UI-потоке: тянут шит вниз — видео растёт за
 * пальцем, закрылся — снова на весь экран.
 *
 * Трансформ, а не высота страницы: от высоты считает смещения лента попсов.
 */
export function useCommentsShrink(height: number, enabled: boolean) {
  const insets = useSafeAreaInsets();

  const videoStyle = useAnimatedStyle(() => {
    const open = enabled ? commentsSheetOpen.value : 0;

    if (open === 0 || height <= 0) return { transform: [{ translateY: 0 }, { scale: 1 }] };

    const top = insets.top;
    const area = Math.max(commentsSheetTop.value - top, 1);
    const scale = Math.min(area / height, 1);
    const shift = top + area / 2 - height / 2;

    return {
      transform: [{ translateY: shift * open }, { scale: 1 + (scale - 1) * open }],
    };
  });

  const chromeStyle = useAnimatedStyle(() => ({
    opacity: enabled ? 1 - commentsSheetOpen.value : 1,
  }));

  return { videoStyle, chromeStyle };
}
