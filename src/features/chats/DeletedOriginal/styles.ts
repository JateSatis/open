import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

// Та же геометрия, что у чужого облачка (`MessageBubble`): заглушка стоит
// там, где стояло сообщение, и не сдвигает соседей.
export const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  avatarSlot: {
    width: Spacing.five,
  },
  bubble: {
    maxWidth: '78%',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.lg,
  },
});
