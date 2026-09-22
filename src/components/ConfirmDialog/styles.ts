import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

/** Узкая карточка по центру экрана — шире незачем даже на планшете. */
const CARD_MAX_WIDTH = 360;

export const styles = StyleSheet.create({
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
