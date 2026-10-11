import { useEffect } from 'react';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { Typography } from '@/theme';

export const HEART = '❤️';

const POP_SPRING = { damping: 9, stiffness: 260 };
const HOLD_MS = 220;
const FADE_MS = 380;
/** Сердце уходит вверх на свою высоту, пока тает. */
const RISE = Typography.popHeart.lineHeight;
/** Каждое следующее сердце чуть повёрнуто — серия тапов не сливается в одно. */
const TILT_DEG = 18;

export type Heart = { key: number; x: number; y: number; tilt: number };

export function randomTilt(): number {
  return (Math.random() * 2 - 1) * TILT_DEG;
}

/** Сердце в точке двойного тапа: выпрыгивает, держится и тает, уходя вверх. */
export function HeartBurst({ heart, onDone }: { heart: Heart; onDone: (key: number) => void }) {
  const scale = useSharedValue(0);
  const fade = useSharedValue(1);

  useEffect(() => {
    scale.set(withSpring(1, POP_SPRING));
    fade.set(
      withDelay(
        HOLD_MS,
        withSequence(
          withTiming(0, { duration: FADE_MS, easing: Easing.in(Easing.quad) }, (finished) => {
            if (finished) runOnJS(onDone)(heart.key);
          }),
        ),
      ),
    );
  }, [fade, heart.key, onDone, scale]);

  const style = useAnimatedStyle(() => ({
    opacity: fade.get(),
    transform: [
      { translateY: -(1 - fade.get()) * RISE },
      { rotate: `${heart.tilt}deg` },
      { scale: scale.get() * (1 + (1 - fade.get()) * 0.3) },
    ],
  }));

  return (
    <Animated.View
      testID="pop-heart"
      pointerEvents="none"
      style={[
        styles.heart,
        { left: heart.x - RISE / 2, top: heart.y - RISE / 2, width: RISE, height: RISE },
        style,
      ]}
    >
      <Text variant="popHeart">{HEART}</Text>
    </Animated.View>
  );
}
