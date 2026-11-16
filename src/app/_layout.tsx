// Первым: livekit-client ждёт WebRTC в глобальной области с момента загрузки.
import '@/features/streams/livekitGlobals';

import { Stack } from 'expo-router';

import { AppRoot } from '@/AppRoot';
import { SLIDE_PAGE } from '@/components/SlidePage/screenOptions';

export default function RootLayout() {
  return (
    <AppRoot>
      <Stack screenOptions={{ headerShown: false }}>
        {/* Дата рождения при первом входе: пропустить нельзя, уйти жестом — тоже. */}
        <Stack.Screen name="birth-date" options={{ gestureEnabled: false }} />
        <Stack.Screen
          name="call"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
        {/* Редактор попа — во весь экран, поверх вкладок, как камера в TikTok. */}
        <Stack.Screen name="pop-editor/[channelId]" />
        {/* Просмотр попсов — на весь экран, без вкладок, на чёрном фоне. */}
        <Stack.Screen name="pops/[channelId]" options={{ statusBarStyle: 'light' }} />
        <Stack.Screen name="pops/search" options={{ statusBarStyle: 'light' }} />
        {/* Канал из «Ленты» — поверх вкладок, страницей (см. `SlidePage`). */}
        <Stack.Screen name="channel/[channelId]" options={SLIDE_PAGE} />
      </Stack>
    </AppRoot>
  );
}
