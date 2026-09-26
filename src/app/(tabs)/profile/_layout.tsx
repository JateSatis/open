import { Stack } from 'expo-router';

import { ConnectionTitle } from '@/features/connection/ConnectionTitle';
import { SettingsButton } from '@/features/profile/SettingsButton';

export default function ProfileLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          headerTitle: () => <ConnectionTitle title="Профиль" />,
          headerRight: () => <SettingsButton />,
        }}
      />
      <Stack.Screen
        name="edit"
        options={{ headerTitle: () => <ConnectionTitle title="Редактирование" /> }}
      />
      <Stack.Screen
        name="account"
        options={{ headerTitle: () => <ConnectionTitle title="Аккаунт" /> }}
      />
      {/* Static "edit" and "account" win over this route, so they are unambiguous. */}
      <Stack.Screen
        name="[userId]"
        options={{ headerTitle: () => <ConnectionTitle title="Профиль" /> }}
      />
    </Stack>
  );
}
