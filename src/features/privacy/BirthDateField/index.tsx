import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { BirthDatePicker } from '@/features/privacy/BirthDatePicker';
import { useTheme } from '@/hooks/use-theme';
import { formatDateOnly } from '@/lib/dates';

export type BirthDateFieldProps = {
  /** `YYYY-MM-DD` или null — ещё не выбрана. */
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
};

/** Поле даты на экране первого входа: значение и выбор по нажатию. */
export function BirthDateField({ value, onChange, disabled = false }: BirthDateFieldProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <View>
      <Pressable
        testID="birth-date-field"
        accessibilityRole="button"
        accessibilityLabel={
          value ? `Дата рождения: ${formatDateOnly(value)}` : 'Выбрать дату рождения'
        }
        disabled={disabled}
        onPress={() => setOpen((current) => !current)}
        style={[styles.field, { backgroundColor: theme.backgroundElement }]}
      >
        <Text variant="body" color={value ? 'text' : 'textSecondary'}>
          {value ? formatDateOnly(value) : 'Выберите дату'}
        </Text>
      </Pressable>

      {open ? (
        <BirthDatePicker value={value} onPick={onChange} onClose={() => setOpen(false)} />
      ) : null}
    </View>
  );
}
