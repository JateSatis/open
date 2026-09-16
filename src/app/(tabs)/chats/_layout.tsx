import { Stack } from 'expo-router';

export default function ChatsLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Чаты' }} />
      <Stack.Screen name="[chatId]" options={{ title: 'Чат' }} />
    </Stack>
  );
}
