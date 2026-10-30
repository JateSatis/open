import { StyleSheet } from 'react-native';

import { Opacity, Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  fill: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '85%',
    borderTopLeftRadius: Radii.lg,
    borderTopRightRadius: Radii.lg,
  },
  grabber: {
    alignSelf: 'center',
    width: Sizes.savedFilterGrabberWidth,
    height: Spacing.one,
    marginVertical: Spacing.two,
    borderRadius: Radii.full,
  },
  content: {
    paddingHorizontal: Spacing.three,
    gap: Spacing.four,
  },
  group: {
    gap: Spacing.two,
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  option: {
    minHeight: Spacing.five,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.full,
  },
  optionDisabled: {
    opacity: Opacity.disabled,
  },
  dates: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  dateField: {
    flex: 1,
    minHeight: Spacing.five + Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.md,
  },
  dateValue: {
    flex: 1,
  },
});
