import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
  },
  header: {
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.six,
  },
  centered: {
    textAlign: 'center',
  },
  onAir: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    marginTop: Spacing.two,
  },
  dot: {
    width: Sizes.onAirDot,
    height: Sizes.onAirDot,
    borderRadius: Sizes.onAirDot / 2,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: Spacing.six,
  },
  action: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  round: {
    width: Sizes.callControl,
    height: Sizes.callControl,
    borderRadius: Sizes.callControl / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
