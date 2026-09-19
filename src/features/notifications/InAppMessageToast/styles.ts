import { StyleSheet } from 'react-native';

import { Radii, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    zIndex: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radii.md,
    borderWidth: 1,
    padding: Spacing.three,
    // Уведомление лежит поверх переписки, поэтому должно читаться как
    // отдельный слой, а не сливаться с сообщениями под ним.
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  body: {
    flex: 1,
  },
});
