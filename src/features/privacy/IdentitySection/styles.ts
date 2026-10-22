import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

export const styles = StyleSheet.create({
  group: {
    gap: Spacing.three,
  },
  groupTitle: {
    marginHorizontal: Spacing.three,
  },
  // Как строка настроек: те же поля, но текст переносится.
  alias: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three - Spacing.one,
  },
  message: {
    marginHorizontal: Spacing.three,
  },
});
