import { useState } from 'react';
import { View } from 'react-native';

import { styles } from './styles';

import { LinkButton } from '@/components/LinkButton';
import { SettingsRow } from '@/components/SettingsRow';
import { SettingsSection } from '@/components/SettingsSection';
import { Text } from '@/components/Text';
import { BirthDatePicker, PICKER_COMMITS_ON_PICK } from '@/features/privacy/BirthDatePicker';
import { describeBirthDateError } from '@/features/privacy/birthDateErrors';
import { useMyPrivacySettings, useSetBirthDate } from '@/features/privacy/queries';
import { formatDateOnly } from '@/lib/dates';

/**
 * Дата рождения в «Аккаунте» — видна только самому человеку. Смена даты
 * настроек конфиденциальности не трогает: значения по возрасту выставляются
 * один раз, при первой дате.
 */
export function BirthDateSection() {
  const { data } = useMyPrivacySettings();
  const save = useSetBirthDate('edit');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const current = data?.birthDate ?? null;

  const commit = (value: string) => {
    setOpen(false);
    if (value !== current) save.mutate(value);
  };

  const problem = describeBirthDateError(save.error);

  return (
    <SettingsSection
      title="Личное"
      footer="Дату рождения видите только вы. Её изменение не меняет настройки конфиденциальности."
    >
      <SettingsRow
        testID="account-birth-date"
        title="Дата рождения"
        subtitle={save.isPending ? 'Сохраняем…' : current ? formatDateOnly(current) : null}
        onPress={() => {
          save.reset();
          setDraft(current);
          setOpen((value) => !value);
        }}
      />
      {open ? (
        <BirthDatePicker
          value={draft ?? current}
          onPick={(value) => (PICKER_COMMITS_ON_PICK ? commit(value) : setDraft(value))}
          onClose={() => setOpen(false)}
        />
      ) : null}
      {open && !PICKER_COMMITS_ON_PICK ? (
        <View style={styles.actions}>
          <LinkButton label="Отмена" color="textSecondary" onPress={() => setOpen(false)} />
          <LinkButton label="Сохранить" onPress={() => commit(draft ?? current ?? '')} />
        </View>
      ) : null}
      {problem ? (
        <Text variant="small" color="danger" style={styles.error}>
          {problem}
        </Text>
      ) : null}
    </SettingsSection>
  );
}
