import { Stack } from 'expo-router';

export default function FeedLayout() {
  return (
    <Stack>
      {/* Шапки нет: сверху сразу поиск, связь — полоской (ConnectionBanner). */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  );
}
