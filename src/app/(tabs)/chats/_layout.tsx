import { Stack } from 'expo-router';

import { SLIDE_PAGE } from '@/components/SlidePage/screenOptions';

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
      <Stack.Screen name="forward" options={{ title: 'Кому переслать' }} />
      {/* Переписка, канал и чужой профиль — страницы: рисуют свою шапку, сами
          въезжают и уезжают за пальцем, прозрачные поверх предыдущего экрана,
          чтобы тот был виден, пока страницу тянут (см. `SlidePage`). */}
      <Stack.Screen name="people/[userId]" options={SLIDE_PAGE} />
      <Stack.Screen name="[chatId]" options={SLIDE_PAGE} />
      <Stack.Screen name="request/[userId]" options={SLIDE_PAGE} />
      <Stack.Screen name="channel/[channelId]" options={SLIDE_PAGE} />
      <Stack.Screen name="channel-subscribers/[channelId]" options={{ title: 'Подписчики' }} />
      <Stack.Screen name="chat-subscribers/[chatId]" options={{ title: 'Подписчики' }} />
      {/* Страница информации — тоже страница поверх переписки. */}
      <Stack.Screen name="chat-info/[chatId]" options={SLIDE_PAGE} />
      <Stack.Screen name="channel-info/[channelId]" options={SLIDE_PAGE} />
      <Stack.Screen name="chat-edit/[chatId]" options={{ title: 'Изменить' }} />
      <Stack.Screen name="channel-edit/[channelId]" options={{ title: 'Изменить' }} />
      <Stack.Screen name="chat-invite/[chatId]" options={{ title: 'Добавить участников' }} />
    </Stack>
  );
}
