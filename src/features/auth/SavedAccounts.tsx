import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { requestSelection } from '@/api/screenRequest';
import { confirm } from '@/components/ConfirmDialog/store';
import { LinkButton } from '@/components/LinkButton';
import { SettingsRow } from '@/components/SettingsRow';
import { SettingsSection } from '@/components/SettingsSection';
import { Text } from '@/components/Text';
import { Spacing } from '@/theme';
import { chooseSavedAccount } from './accountChoice';
import type { AccountSlot } from './accountStorage';
import { ProviderButtons } from './ProviderButtons';
import { useSessionStore } from './sessionState';
import { signOutSavedAccount } from './signOut';
import { loadAccountLabels, savedSessionOwner } from './sessionStore';

type Props = { manage?: boolean; otherAccountsOnly?: boolean };

export function SavedAccounts({ manage = false, otherAccountsOnly = false }: Props) {
  const accounts = useSessionStore(state => state.accounts);
  const selected = useSessionStore(state => state.localAccountId);
  const selection = requestSelection();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { void loadAccountLabels(accounts).catch(() => {}); }, [accounts]);
  const visible = otherAccountsOnly ? accounts.filter(slot => slot.userId !== selected) : accounts;
  if (!manage && !visible.length) return null;

  async function remove(slot: AccountSlot) {
    const owner = await savedSessionOwner(slot);
    if (selection !== requestSelection() || !useSessionStore.getState().accounts.includes(slot)) return;
    const agreed = await confirm({
      title: 'Выйти из аккаунта?',
      message: `Вы выйдете из ${slot.email || slot.userId} только на этом устройстве.`,
      confirmLabel: 'Выйти',
      cancelLabel: 'Отмена',
      destructive: true,
    });
    if (agreed) await signOutSavedAccount(slot, selection, owner);
  }

  function run(action: Promise<void>) {
    setError('');
    void action.catch(() => setError('Не удалось изменить список аккаунтов. Попробуйте ещё раз.'));
  }

  return (
    <SettingsSection title={otherAccountsOnly ? 'Переключиться на другой аккаунт' : 'Аккаунты на устройстве'}>
      {visible.map((slot, i) => {
        const current = slot.userId === selected;
        const label = slot.email || slot.userId;
        return (
          <View key={slot.key} style={styles.row}>
            <View style={styles.choice}>
              <SettingsRow
                divided={i > 0}
                title={label}
                subtitle={current ? 'Выбран' : undefined}
                testID={`account-select-${slot.userId}`}
                onPress={current ? undefined : () => run(chooseSavedAccount(slot, selection))}
              />
            </View>
            {manage && !current && (
              <LinkButton label="Выйти" accessibilityLabel={`Выйти из ${label}`} onPress={() => run(remove(slot))} />
            )}
          </View>
        );
      })}
      {manage && (
        <SettingsRow title="Добавить аккаунт" testID="account-add" divided={!!visible.length} onPress={() => setAdding(!adding)} />
      )}
      {adding && <View style={styles.providers}><ProviderButtons /></View>}
      {!!error && <Text variant="small" color="danger" accessibilityRole="alert">{error}</Text>}
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingRight: Spacing.three },
  choice: { flex: 1 },
  providers: { paddingHorizontal: Spacing.three },
});
