import { Stack } from 'expo-router';

import { SLIDE_PAGE } from '@/components/SlidePage/screenOptions';
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
      <Stack.Screen
        name="privacy"
        options={{ headerTitle: () => <ConnectionTitle title="Конфиденциальность" /> }}
      />
      <Stack.Screen
        name="blocked"
        options={{ headerTitle: () => <ConnectionTitle title="Заблокированные" /> }}
      />
      <Stack.Screen
        name="friends/index"
        options={{ headerTitle: () => <ConnectionTitle title="Друзья" /> }}
      />
      <Stack.Screen
        name="friends/[userId]"
        options={{ headerTitle: () => <ConnectionTitle title="Друзья" /> }}
      />
      {/* Static "edit" and "account" win over this route, so they are unambiguous.
          Чужой профиль — страница (см. `SlidePage`). */}
      <Stack.Screen name="[userId]" options={SLIDE_PAGE} />
    </Stack>
  );
}
