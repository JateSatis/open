import { impactAsync, ImpactFeedbackStyle } from 'expo-haptics';
import { useCallback, useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Sizes, Spacing } from '@/theme';

const RETURN_MS = 180;
/** Стрелка вырастает из этого размера до полного, пока облачко идёт к порогу. */
const ICON_START_SCALE = 0.6;

/**
 * Ответ свайпом, как в Telegram: облачко тянется влево за пальцем, из-под
 * него выезжает стрелка, отпустил за порогом или резко бросил влево — ответ.
 *
 * С чем жест не спорит:
 * - системный «назад» на iOS — это свайп от левого края вправо, здесь только влево;
 *   на Android краевые жесты перехватывает система раньше приложения;
 * - перемотка голосового — она включается на меньшем сдвиге и забирает
 *   касание раньше, так что по волне свайп не срабатывает;
 * - прокрутка переписки — вертикальный сдвиг гасит жест.
 */
export function useSwipeReply(
  messageId: string,
  enabled: boolean,
  onReply: (() => void) | undefined,
) {
  const offset = useSharedValue(0);
  const armed = useSharedValue(false);

  const reply = useCallback(() => onReply?.(), [onReply]);
  const buzz = useCallback(() => {
    impactAsync(ImpactFeedbackStyle.Light).catch(() => undefined);
  }, []);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled && onReply !== undefined)
        .withTestId(`message-swipe-reply-${messageId}`)
        .activeOffsetX(-Sizes.swipeReplyActivation)
        .failOffsetY([-Spacing.three, Spacing.three])
        .onUpdate((event) => {
          // Сдвиг уже считается от точки, где жест узнал себя, а не от
          // касания: облачко не прыгает на порог активации. Вычитать его ещё
          // раз нельзя — палец проходил бы лишние 12 dp вхолостую.
          const shift = Math.min(0, event.translationX);
          const reached = -shift >= Sizes.swipeReplyThreshold;

          if (reached !== armed.get()) {
            armed.set(reached);

            if (reached) runOnJS(buzz)();
          }

          offset.set(Math.max(shift, -Sizes.swipeReplyMax));
        })
        .onEnd((event) => {
          if (armed.get()) {
            runOnJS(reply)();
            return;
          }

          // Бросок: до порога облачко не доехало, но палец явно уходил
          // влево. Вибро — тем же ударом, что на пороге.
          const flung =
            event.velocityX <= -Sizes.swipeReplyFlingVelocity &&
            -offset.get() >= Sizes.swipeReplyFlingShift;

          if (flung) {
            runOnJS(buzz)();
            runOnJS(reply)();
          }
        })
        .onFinalize(() => {
          armed.set(false);
          offset.set(withTiming(0, { duration: RETURN_MS }));
        }),
    [armed, buzz, enabled, messageId, offset, onReply, reply],
  );

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.get() }],
  }));

  const iconStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      -offset.get(),
      [0, Sizes.swipeReplyThreshold],
      [0, 1],
      Extrapolation.CLAMP,
    );

    return { opacity: progress, transform: [{ scale: ICON_START_SCALE + progress * (1 - ICON_START_SCALE) }] };
  });

  return { gesture, contentStyle, iconStyle };
}
