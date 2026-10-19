import { Stack } from 'expo-router';

import { ConnectionTitle } from '@/features/connection/ConnectionTitle';

export default function ProfileLayout() {
  return (
    <Stack>
      {/* Шапки нет: сверху фото, шестерёнка на нём, связь — полоской (ConnectionBanner). */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
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
