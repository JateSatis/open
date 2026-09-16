import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';

import { UsernameTakenError } from '@/api/profile';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { ProfileLoader } from '@/features/profile/ProfileLoader';
import { useMyProfile, useUpdateMyProfile } from '@/features/profile/queries';
import {
  BIO_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
  validateUsername,
} from '@/features/profile/username';
import { Spacing } from '@/theme';

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { gap: Spacing.three },
  bio: { minHeight: Spacing.six },
});

export default function EditProfileScreen() {
  const { data: profile, isPending, error, refetch } = useMyProfile();

  return (
    <Screen scrollable contentContainerStyle={styles.content}>
      <ProfileLoader isPending={isPending} error={error} onRetry={() => refetch()}>
        {profile ? (
          <EditProfileForm
            key={profile.id}
            initial={{
              username: profile.username ?? '',
              displayName: profile.displayName ?? '',
              bio: profile.bio ?? '',
            }}
          />
        ) : null}
      </ProfileLoader>
    </Screen>
  );
}

type FormValues = { username: string; displayName: string; bio: string };

function EditProfileForm({ initial }: { initial: FormValues }) {
  const [values, setValues] = useState(initial);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const update = useUpdateMyProfile();

  const setField = (field: keyof FormValues) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const onSave = () => {
    const username = values.username.trim();
    const invalid = validateUsername(username);

    if (invalid) {
      setUsernameError(invalid);
      return;
    }

    setUsernameError(null);
    update.mutate(
      {
        username,
        displayName: values.displayName.trim() || null,
        bio: values.bio.trim() || null,
      },
      {
        onSuccess: () => router.back(),
        onError: (mutationError) => {
          if (mutationError instanceof UsernameTakenError) {
            setUsernameError('Это имя уже занято');
          }
        },
      },
    );
  };

  const failedForOtherReason = update.error && !(update.error instanceof UsernameTakenError);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.select({ ios: 'padding', default: undefined })}>
      <Input
        label="Имя пользователя"
        value={values.username}
        onChangeText={setField('username')}
        error={usernameError ?? undefined}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={USERNAME_MAX_LENGTH}
        placeholder="username"
      />

      <Input
        label="Имя"
        value={values.displayName}
        onChangeText={setField('displayName')}
        maxLength={DISPLAY_NAME_MAX_LENGTH}
        placeholder="Как вас зовут"
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

      {failedForOtherReason ? (
        <Text variant="small" color="danger">
          Не удалось сохранить. Попробуйте ещё раз.
        </Text>
      ) : null}

      <Button label="Сохранить" loading={update.isPending} onPress={onSave} />
    </KeyboardAvoidingView>
  );
}
