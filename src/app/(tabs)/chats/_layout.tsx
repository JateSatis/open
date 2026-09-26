import { Stack } from 'expo-router';

import { NewChatButton } from '@/features/chats/NewChatButton';
import { ConnectionTitle } from '@/features/connection/ConnectionTitle';

export default function ChatsLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          headerTitle: () => <ConnectionTitle title="Чаты" />,
          headerRight: () => <NewChatButton />,
        }}
      />
      <Stack.Screen name="new" options={{ title: 'Новый чат' }} />
      <Stack.Screen name="invites" options={{ title: 'Заявки' }} />
      {/* Заголовок диалога ставит сам экран: он знает имя собеседника. */}
      <Stack.Screen name="[chatId]" options={{ title: 'Чат' }} />
    </Stack>
  );
}
