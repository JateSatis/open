import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

/** Узкая карточка по центру экрана — шире незачем даже на планшете. */
const CARD_MAX_WIDTH = 360;

export const styles = StyleSheet.create({
  /**
   * Вопрос, нарисованный внутри чужого экрана. Затемнение обязано лежать
   * поверх всего окна, а не занимать место в потоке родителя: внутри шита
   * оно иначе оказывается тем, что осталось от экрана после списка, и
   * карточка съезжает вниз вместе с ним.
   */
  surface: {
    ...StyleSheet.absoluteFill,
  },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: {
    width: '100%',
    maxWidth: CARD_MAX_WIDTH,
    borderRadius: Radii.lg,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  title: {
    textAlign: 'center',
  },
  message: {
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  action: {
    flex: 1,
  },
});
