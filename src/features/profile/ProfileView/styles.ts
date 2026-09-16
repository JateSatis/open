import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

export const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  identity: {
    alignItems: 'center',
    gap: Spacing.half,
  },
  bio: {
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  actions: {
    alignSelf: 'stretch',
    gap: Spacing.two,
    marginTop: Spacing.four,
  },
});
