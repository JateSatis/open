import { Stack } from 'expo-router';


// Открыли канал ссылкой при холодном старте — под ним всё равно «Чаты»:
// «назад» ведёт в список, а не из приложения.
export const unstable_settings = { initialRouteName: 'index' };

export default function ChatsLayout() {
  return (
    <Stack>
      {/* Шапки у корня нет: сверху сразу поиск, связь — полоской (ConnectionBanner). */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="new" options={{ title: 'Новый чат' }} />
      <Stack.Screen name="new-channel" options={{ title: 'Новый канал' }} />
      <Stack.Screen name="invites" options={{ title: 'Заявки' }} />
      <Stack.Screen name="forward" options={{ title: 'Переслать' }} />
      {/* Имя человека ставит сам экран, когда профиль загрузится. */}
      <Stack.Screen name="people/[userId]" options={{ title: 'Профиль' }} />
      {/* Заголовок диалога ставит сам экран: он знает имя собеседника. */}
      <Stack.Screen name="[chatId]" options={{ title: 'Чат' }} />
      {/* Шапку канала ставит его раздел «Посты»: он знает название и аватарку. */}
      <Stack.Screen name="channel/[channelId]" options={{ title: 'Канал' }} />
      <Stack.Screen name="channel-subscribers/[channelId]" options={{ title: 'Подписчики' }} />
      <Stack.Screen name="chat-subscribers/[chatId]" options={{ title: 'Подписчики' }} />
      {/* Страница информации рисует свою панель и сама въезжает и уезжает:
          прозрачная поверх переписки, чтобы та была видна, пока страницу
          тянут назад (см. `useSlideBack`). */}
      <Stack.Screen
        name="chat-info/[chatId]"
        options={{ headerShown: false, presentation: 'transparentModal', animation: 'none' }}
      />
      <Stack.Screen
        name="channel-info/[channelId]"
        options={{ headerShown: false, presentation: 'transparentModal', animation: 'none' }}
      />
      <Stack.Screen name="chat-edit/[chatId]" options={{ title: 'Изменить' }} />
      <Stack.Screen name="channel-edit/[channelId]" options={{ title: 'Изменить' }} />
      <Stack.Screen name="chat-invite/[chatId]" options={{ title: 'Добавить участников' }} />
    </Stack>
  );
}
