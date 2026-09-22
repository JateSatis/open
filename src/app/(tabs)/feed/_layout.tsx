import { Stack } from 'expo-router';

import { ConnectionTitle } from '@/features/connection/ConnectionTitle';

export default function FeedLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{ headerTitle: () => <ConnectionTitle title="Лента" /> }}
      />
    </Stack>
  );
}
