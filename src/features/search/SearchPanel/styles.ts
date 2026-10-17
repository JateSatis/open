import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

export const styles = StyleSheet.create({
  // Последняя строка не прячется под панелью вкладок и встаёт над клавиатурой
  // с запасом, когда список докручен до конца.
  notice: {
    paddingTop: Spacing.two,
  },
  empty: {
    paddingTop: Spacing.four,
    textAlign: 'center',
  },
  footer: {
    paddingVertical: Spacing.three,
  },
});
