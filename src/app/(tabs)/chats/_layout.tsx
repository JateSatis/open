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
      <Stack.Screen name="forward" options={{ title: 'Переслать' }} />
      {/* Имя человека ставит сам экран, когда профиль загрузится. */}
      <Stack.Screen name="people/[userId]" options={{ title: 'Профиль' }} />
      {/* Заголовок диалога ставит сам экран: он знает имя собеседника. */}
      <Stack.Screen name="[chatId]" options={{ title: 'Чат' }} />
    </Stack>
  );
}
