import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

export const styles = StyleSheet.create({
  /**
   * У содержимого нет собственных отступов: положение строки считается
   * формулой в `getItemLayout`, и любой отступ контейнера пришлось бы в неё
   * закладывать. Отступы живут внутри строки.
   */
  content: {},
  row: {
    gap: Spacing.half,
    paddingHorizontal: Spacing.half,
    paddingBottom: Spacing.half,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  noticeText: {
    textAlign: 'center',
  },
});
