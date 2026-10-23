import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';

import { UsernameTakenError } from '@/api/profile';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { AvatarEditor } from '@/features/profile/AvatarEditor';
import { ProfileLoader } from '@/features/profile/ProfileLoader';
import { useMyProfile, useUpdateMyProfile } from '@/features/profile/queries';
import {
  BIO_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  STATUS_MAX_LENGTH,
  validateUsername,
} from '@/features/profile/username';
import { UsernameField } from '@/features/profile/UsernameField';
import { useUsernameAvailability } from '@/features/profile/useUsernameAvailability';
import { PersonalDataHint } from '@/features/privacy/PersonalDataHint';
import { usePersonalDataGuard } from '@/features/privacy/usePersonalDataGuard';
import { Spacing } from '@/theme';

const styles = StyleSheet.create({
  form: { flex: 1, gap: Spacing.three },
  content: { gap: Spacing.three },
  bio: { minHeight: Spacing.six },
});

export default function EditProfileScreen() {
  const { data: profile, isPending, error, refetch } = useMyProfile();

  return (
    <Screen scrollable contentContainerStyle={styles.content}>
      <ProfileLoader isPending={isPending} error={error} onRetry={() => refetch()}>
        {profile ? <AvatarEditor profile={profile} /> : null}
        {profile ? (
          <EditProfileForm
            key={profile.id}
            initial={{
              username: profile.username ?? '',
              displayName: profile.displayName ?? '',
              status: profile.status ?? '',
              bio: profile.bio ?? '',
            }}
          />
        ) : null}
      </ProfileLoader>
    </Screen>
  );
}

type FormValues = { username: string; displayName: string; status: string; bio: string };

function EditProfileForm({ initial }: { initial: FormValues }) {
  const [values, setValues] = useState(initial);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const availability = useUsernameAvailability(values.username, {
    kind: 'profile',
    current: initial.username,
  });
  const update = useUpdateMyProfile();
  // «О себе» видит каждый, кто откроет профиль: адрес или школа — сначала лист.
  const guard = usePersonalDataGuard({
    audience: '«О себе» увидят все, кто откроет ваш профиль.',
    sendAsIsLabel: 'Сохранить как есть',
  });

  const setField = (field: keyof FormValues) => (value: string) => {
    if (field === 'username') setUsernameError(null);
    setValues((current) => ({ ...current, [field]: value }));
  };

  const save = () => {
    const username = values.username.trim();
    const invalid = validateUsername(username);

    if (invalid) {
      setUsernameError(invalid);
      return;
    }

    // Занятость, известная заранее, — не повод ходить на сервер. Пока ответа
    // нет, сохраняем: уникальный индекс в базе всё равно проверит.
    if (availability.status === 'taken') return;

    setUsernameError(null);
    update.mutate(
      {
        // Пустое поле — имени нет: у человека username необязателен.
        username: username || null,
        displayName: values.displayName.trim() || null,
        status: values.status.trim() || null,
        bio: values.bio.trim() || null,
      },
      {
        onSuccess: () => router.back(),
        onError: (mutationError) => {
          if (mutationError instanceof UsernameTakenError) {
            setUsernameError('Имя занято');
          }
        },
      },
    );
  };

  const onSave = () => guard.check(values.bio, save);

  const failedForOtherReason = update.error && !(update.error instanceof UsernameTakenError);

  return (
    <KeyboardAvoidingView
      style={styles.form}
      behavior={Platform.select({ ios: 'padding', default: undefined })}
    >
      <UsernameField
        testID="profile-username"
        kind="profile"
        label="Имя пользователя"
        value={values.username}
        onChangeText={setField('username')}
        availability={availability}
        error={usernameError}
      />

      <Input
        label="Имя"
        value={values.displayName}
        onChangeText={setField('displayName')}
        maxLength={DISPLAY_NAME_MAX_LENGTH}
        placeholder="Как вас зовут"
      />

      <Input
        label="Статус"
        value={values.status}
        onChangeText={setField('status')}
        maxLength={STATUS_MAX_LENGTH}
        placeholder="Например: в отпуске"
      />

      <Input
        label="О себе"
        value={values.bio}
        onChangeText={setField('bio')}
        maxLength={BIO_MAX_LENGTH}
        multiline
        style={styles.bio}
        placeholder="Пара строк о себе"
      />
      <PersonalDataHint text={values.bio} audience="увидят все, кто откроет ваш профиль" />

      {failedForOtherReason ? (
        <Text variant="small" color="danger">
          Не удалось сохранить. Попробуйте ещё раз.
        </Text>
      ) : null}

      <Button label="Сохранить" loading={update.isPending} onPress={onSave} />
      {guard.sheet}
    </KeyboardAvoidingView>
  );
}
