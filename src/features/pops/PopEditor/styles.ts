import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing } from '@/theme';

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    minHeight: Sizes.popEditorButton,
  },
  iconButton: {
    width: Sizes.popEditorButton,
    height: Sizes.popEditorButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.three,
  },
  preview: {
    ...StyleSheet.absoluteFill,
  },
  hint: {
    textAlign: 'center',
  },
  error: {
    textAlign: 'center',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  form: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  title: {
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  caption: {
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    maxHeight: Sizes.popEditorButton * 2,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  mediaButton: {
    width: Sizes.popEditorButton,
    height: Sizes.popEditorButton,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
