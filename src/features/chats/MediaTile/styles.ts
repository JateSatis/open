import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

/** Кружок ▶ в центре видео — как в Telegram. */
const PLAY_SIZE = Spacing.five + Spacing.two;

export const styles = StyleSheet.create({
  tile: {
    position: 'absolute',
    overflow: 'hidden',
  },
  image: {
    flex: 1,
  },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  play: {
    width: PLAY_SIZE,
    height: PLAY_SIZE,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Треугольник визуально тяжелее слева — сдвиг вправо ставит его в центр круга.
  playGlyph: {
    marginLeft: Spacing.half,
  },
  duration: {
    position: 'absolute',
    left: Spacing.one,
    top: Spacing.one,
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.half,
    borderRadius: Radii.sm,
  },
});
