import { StyleSheet } from 'react-native';

import { Spacing } from '@/theme';

/** Зазор между плитками попсов — и по горизонтали, и между рядами. */
export const POP_GAP = Spacing.three;

export const styles = StyleSheet.create({
  // Последний ряд не прячется под панелью вкладок и встаёт над клавиатурой
  // с запасом, когда список докручен до конца.
  content: {
    paddingBottom: Spacing.six,
  },
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
  recent: {
    paddingVertical: Spacing.two,
  },
  popRow: {
    flexDirection: 'row',
    gap: POP_GAP,
    paddingBottom: POP_GAP,
  },
});
