import { Stack } from 'expo-router';

import { ConnectionTitle } from '@/features/connection/ConnectionTitle';

export default function ProfileLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{ headerTitle: () => <ConnectionTitle title="Профиль" /> }}
      />
      <Stack.Screen
        name="edit"
        options={{ headerTitle: () => <ConnectionTitle title="Редактирование" /> }}
      />
      {/* Static "edit" wins over this route, so /profile/edit is unambiguous. */}
      <Stack.Screen
        name="[userId]"
        options={{ headerTitle: () => <ConnectionTitle title="Профиль" /> }}
      />
    </Stack>
  );
}
