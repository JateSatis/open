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
  // Круг растёт вверх от низа строки, а не во все стороны от центра кнопки:
  // под строкой таб-бар, и он обрезал бы нижнюю половину круга.
  circle: {
    position: 'absolute',
    bottom: -Spacing.two,
    width: ACTIVE_CIRCLE,
    height: ACTIVE_CIRCLE,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lock: {
    position: 'absolute',
    bottom: ACTIVE_CIRCLE + Spacing.two,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Radii.full,
    gap: Spacing.half,
  },
});
