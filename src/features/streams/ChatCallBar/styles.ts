import { StyleSheet } from 'react-native';

import { Colors, Radii, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  body: {
    flex: 1,
  },
  action: {
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    // Белая пилюля на зелёной полосе — в обеих темах одинаково.
    backgroundColor: Colors.light.textOnMedia,
  },
});
