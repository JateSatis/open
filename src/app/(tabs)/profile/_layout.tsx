import { Stack } from 'expo-router';

export default function ProfileLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Профиль' }} />
      <Stack.Screen name="edit" options={{ title: 'Редактирование' }} />
      {/* Static "edit" wins over this route, so /profile/edit is unambiguous. */}
      <Stack.Screen name="[userId]" options={{ title: 'Профиль' }} />
    </Stack>
  );
}
