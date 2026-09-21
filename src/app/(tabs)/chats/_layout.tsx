import { Stack } from 'expo-router';

import { ConnectionTitle } from '@/features/connection/ConnectionTitle';

export default function ChatsLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{ headerTitle: () => <ConnectionTitle title="Чаты" /> }}
      />
      {/* Заголовок диалога ставит сам экран: он знает имя собеседника. */}
      <Stack.Screen name="[chatId]" options={{ title: 'Чат' }} />
    </Stack>
  );
}
