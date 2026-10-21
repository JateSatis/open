import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { Platform, StyleSheet } from 'react-native';

import { defaultPickerDate, fromPickerValue, toPickerValue } from './pickerDate';

export const PICKER_COMMITS_ON_PICK = Platform.OS === 'android';

export type BirthDatePickerProps = {
  /** `YYYY-MM-DD` или null — откроется на середине возрастов. */
  value: string | null;
  /** Выбранный день. На Android — по «ОК» диалога, на iOS — на каждом повороте колёс. */
  onPick: (value: string) => void;
  /** Android: диалог закрыт — компонент надо размонтировать. */
  onClose: () => void;
};

const styles = StyleSheet.create({
  picker: {
    alignSelf: 'stretch',
  },
});

/**
 * Нативный выбор дня рождения: на Android — диалог Material, на iOS — колёса
 * на месте. Будущие дни выбрать нельзя; остальное (например, «младше 13»)
 * решает сервер.
 */
export function BirthDatePicker({ value, onPick, onClose }: BirthDatePickerProps) {
  return (
    <DateTimePicker
      testID="birth-date-picker"
      value={toPickerValue(value ?? defaultPickerDate())}
      mode="date"
      maximumDate={new Date()}
      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
      locale="ru_RU"
      style={styles.picker}
      onValueChange={(_event, date) => {
        onPick(fromPickerValue(date));
        if (PICKER_COMMITS_ON_PICK) onClose();
      }}
      onDismiss={onClose}
    />
  );
}
