import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

/**
 * Круг под пальцем во время записи — заметно больше кнопки, как в Telegram:
 * палец закрывает кнопку, и видно должно быть то, что вокруг него.
 */
export const ACTIVE_CIRCLE = Spacing.six + Spacing.three;
/** Сколько тянуть влево до отмены и вверх до замка. */
export const CANCEL_DISTANCE = Spacing.six * 2;
export const LOCK_DISTANCE = Spacing.six + Spacing.four;

export const styles = StyleSheet.create({
  slot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
  },
  circle: {
    position: 'absolute',
    width: ACTIVE_CIRCLE,
    height: ACTIVE_CIRCLE,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lock: {
    position: 'absolute',
    bottom: ACTIVE_CIRCLE / 2 + Spacing.five,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.full,
    gap: Spacing.half,
  },
});
