import { useState } from 'react';
import { View } from 'react-native';

import { styles } from './styles';

import { BirthDateTooYoungError } from '@/api/privacy';
import { Button } from '@/components/Button';
import { SavedAccounts } from '@/features/auth/SavedAccounts';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useDeleteAccount } from '@/features/auth/accountQueries';
import { confirmedSessionOwner } from '@/features/auth/sessionOwner';
import { useAuthBootstrap } from '@/features/auth/useSession';
import { BirthDateField } from '@/features/privacy/BirthDateField';
import { describeBirthDateError } from '@/features/privacy/birthDateErrors';
import { useSetBirthDate } from '@/features/privacy/queries';
import { useLocalBirthDateDecision } from '@/features/privacy/useLocalBirthDateDecision';

/**
 * Первый вход: дата рождения до вкладок. Пропустить нельзя. Возраст решает
 * сервер: «младше 13» приходит его отказом, и тогда — экран отказа с выходом,
 * который удаляет аккаунт.
 */
export function BirthDateScreen() {
  const { localAccountId, sdkStatus } = useAuthBootstrap();
  if (!localAccountId) return null;
  return <BirthDateForm key={localAccountId} userId={localAccountId} canSubmit={sdkStatus === 'session'} />;
}

function BirthDateForm({ userId, canSubmit }: { userId: string; canSubmit: boolean }) {
  const [date, setDate] = useState<string | null>(null);
  const decision = useLocalBirthDateDecision(userId);
  const [tooYoung, setTooYoung] = useState<boolean | null>(null);
  const save = useSetBirthDate('initial');
  const deletion = useDeleteAccount();

  const onContinue = () => {
    if (!date || !canSubmit) return;

    save.mutate(date, {
      onError: (error) => {
        if (error instanceof BirthDateTooYoungError) setTooYoung(true);
      },
    });
  };

  if (tooYoung ?? (decision === 'tooYoung')) {
    return (
      <Screen scrollable contentContainerStyle={styles.content}>
        <Text variant="title">Регистрация в Open возможна с 13 лет</Text>
        <Text variant="body" color="textSecondary">
          Если дата указана с ошибкой, измените её. Если нет — выйдите: аккаунт будет удалён.
        </Text>
        <View style={styles.actions}>
          <Button
            label="Изменить дату"
            variant="secondary"
            disabled={deletion.isPending}
            onPress={() => {
              save.reset();
              setTooYoung(false);
            }}
          />
          <Button
            label="Выйти"
            variant="danger"
            disabled={!canSubmit}
            loading={deletion.isPending}
            onPress={() => {
              const owner = confirmedSessionOwner();
              if (owner?.userId === userId) deletion.mutate(owner);
            }}
          />
          {deletion.error ? (
            <Text variant="small" color="danger">
              Не удалось удалить аккаунт. Проверьте интернет и попробуйте ещё раз.
            </Text>
          ) : null}
        </View>
        <SavedAccounts otherAccountsOnly />
      </Screen>
    );
  }

  const problem = describeBirthDateError(save.error);

  return (
    <Screen scrollable contentContainerStyle={styles.content}>
      <Text variant="title">Дата рождения</Text>
      <Text variant="body" color="textSecondary">
        От неё зависят начальные настройки конфиденциальности. Дату рождения не видит никто,
        кроме вас.
      </Text>
      <BirthDateField value={date} onChange={setDate} disabled={save.isPending} />
      {problem ? (
        <Text variant="small" color="danger">
          {problem}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          label="Продолжить"
          disabled={!date || !canSubmit}
          loading={save.isPending}
          onPress={onContinue}
        />
      </View>
      <SavedAccounts otherAccountsOnly />
    </Screen>
  );
}
