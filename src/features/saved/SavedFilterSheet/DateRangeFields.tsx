import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { styles } from './styles';

import { Text } from '@/components/Text';
import { fromPickerValue, toPickerValue } from '@/features/privacy/BirthDatePicker/pickerDate';
import { toDay } from '@/features/saved/savedFilters';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing } from '@/theme';

/** На Android выбор — диалог: день приходит по «ОК», и диалог надо снять. */
const COMMITS_ON_PICK = Platform.OS === 'android';

export type DateRangeFieldsProps = {
  from: string | null;
  to: string | null;
  onChange: (dates: { from: string | null; to: string | null }) => void;
};

/**
 * Нижняя граница выбора — начало дня, а не полдень (`toPickerValue`): иначе
 * Material на Android не дал бы выбрать сам день «от».
 */
function dayFloor(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);

  return COMMITS_ON_PICK ? new Date(Date.UTC(year, month - 1, date)) : new Date(year, month - 1, date);
}

function shown(day: string): string {
  const [year, month, date] = day.split('-');

  return `${date}.${month}.${year}`;
}

/**
 * «От» и «до» по дате сохранения: тап — нативный выбор дня, у заданного —
 * крестик. Будущих дней нет, «до» раньше «от» (и «от» позже «до») не
 * выбрать. Можно задать одну границу.
 */
export function DateRangeFields({ from, to, onChange }: DateRangeFieldsProps) {
  const theme = useTheme();
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const today = toDay(new Date());

  const field = (edge: 'from' | 'to', value: string | null, placeholder: string) => (
    <Pressable
      testID={`saved-filter-date-${edge}`}
      accessibilityRole="button"
      accessibilityLabel={value ? `${placeholder} ${shown(value)}` : placeholder}
      onPress={() => setPicking((current) => (current === edge ? null : edge))}
      style={[styles.dateField, { backgroundColor: theme.backgroundElement }]}
    >
      <Text color={value ? 'text' : 'textSecondary'} style={styles.dateValue} numberOfLines={1}>
        {value ? `${placeholder} ${shown(value)}` : placeholder}
      </Text>
      {value ? (
        <Pressable
          testID={`saved-filter-date-${edge}-clear`}
          accessibilityRole="button"
          accessibilityLabel={`Убрать дату «${placeholder}»`}
          hitSlop={Spacing.two}
          onPress={() => onChange(edge === 'from' ? { from: null, to } : { from, to: null })}
        >
          <SymbolView
            name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }}
            size={Sizes.savedFilterChipIcon}
            tintColor={theme.textSecondary}
          />
        </Pressable>
      ) : null}
    </Pressable>
  );

  const pickedValue = picking === 'from' ? (from ?? to ?? today) : (to ?? today);

  return (
    <View>
      <View style={styles.dates}>
        {field('from', from, 'от')}
        {field('to', to, 'до')}
      </View>
      {picking ? (
        <DateTimePicker
          testID="saved-filter-date-picker"
          value={toPickerValue(pickedValue)}
          mode="date"
          minimumDate={picking === 'to' && from ? dayFloor(from) : undefined}
          maximumDate={toPickerValue(picking === 'from' && to ? to : today)}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          locale="ru_RU"
          onValueChange={(_event, date) => {
            const day = fromPickerValue(date);

            onChange(picking === 'from' ? { from: day, to } : { from, to: day });
            if (COMMITS_ON_PICK) setPicking(null);
          }}
          onDismiss={() => setPicking(null)}
        />
      ) : null}
    </View>
  );
}
