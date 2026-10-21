// Первым: livekit-client ждёт WebRTC в глобальной области с момента загрузки.
import { ChatGoneError } from '@/api/chatGone';
import { ProfileUnavailableError } from '@/api/profileErrors';
import '@/features/streams/livekitGlobals';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ScrollTap } from '../../modules/scroll-tap';

import { ConfirmDialogHost } from '@/components/ConfirmDialog';
import { SLIDE_PAGE } from '@/components/SlidePage/screenOptions';
import { AccountLifecycle } from '@/features/auth/AccountLifecycle';
import { ConnectionWatcher } from '@/features/connection/ConnectionWatcher';
import { reportRequestFailed, reportRequestSucceeded } from '@/features/connection/connectionStore';
import { InAppMessageToast } from '@/features/notifications/InAppMessageToast';
import { BirthDateGate } from '@/features/privacy/BirthDateGate';
import { JournalSession } from '@/features/recs/journal/JournalSession';
import { IncomingCallOverlay } from '@/features/streams/IncomingCallOverlay';
import { BelowReturnBar, ReturnToCallBar } from '@/features/streams/ReturnToCallBar';
import { isNetworkError } from '@/lib/network';

SplashScreen.preventAutoHideAsync();

const QUERY_RETRY_DELAY_MS = 1000;

/**
 * Каждый запрос и каждая мутация сообщают, дошли ли они до сервера. Это и есть
 * второй источник правды о связи, помимо сокета: отдельного «пинга» приложение
 * не делает, обходится тем, что и так происходит.
 */
function reportOutcome(error: unknown | null) {
  if (error === null) {
    reportRequestSucceeded();
    return;
  }

  if (isNetworkError(error)) {
    reportRequestFailed();
  }
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  // One client for the whole app: the cache is shared across features, so it
  // must not be recreated on re-render or scoped to a single tab.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Вернулась связь — данные перечитываются, даже если запрос сам по
            // себе ещё не считается устаревшим.
            refetchOnReconnect: 'always',
            // Одна тихая повторная попытка вслед за первой: со сроком запроса
            // (`REQUEST_TIMEOUT_MS`) это около 20 с до того, как экран честно
            // скажет «не удалось загрузить», вместо минуты с лишним по умолчанию.
            // Удалённый чат и недоступный профиль от повтора не вернутся — сразу
            // «Чат удалён» и «Пользователь недоступен».
            retry: (failures, error) =>
              !(error instanceof ChatGoneError) &&
              !(error instanceof ProfileUnavailableError) &&
              failures < 1,
            retryDelay: QUERY_RETRY_DELAY_MS,
          },
        },
        queryCache: new QueryCache({
          onSuccess: () => reportOutcome(null),
          onError: (error) => reportOutcome(error),
        }),
        mutationCache: new MutationCache({
          onSuccess: () => reportOutcome(null),
          onError: (error) => reportOutcome(error),
        }),
      }),
  );

  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    // Нужен react-native-gesture-handler в принципе (им пользуется шит выбора
    // медиа) — без корневой обёртки жесты не работают на Android.
    <GestureHandlerRootView style={styles.flex}>
      {/* Высота клавиатуры кадр в кадр с системной анимацией — в том числе
          внутри окна Modal на Android, где живёт шит выбора медиа. */}
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <SafeAreaProvider>
            <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
              <ConnectionWatcher />
              <AccountLifecycle />
              <BirthDateGate />
              <JournalSession />
              {/* Свёрнутый звонок сдвигает навигатор вниз, а не перекрывает шапки. */}
              <BelowReturnBar>
                {/* Тап по медиа в списке на хвосте прокрутки — с первого
                    касания, см. modules/scroll-tap. Окна Modal — со своей. */}
                <ScrollTap style={styles.flex}>
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
                </ScrollTap>
              </BelowReturnBar>
              <ReturnToCallBar />
              {/* Входящий звонок — своим окном поверх всего, включая нативные вкладки. */}
              <IncomingCallOverlay />
              {/* Поверх навигатора: уведомление не принадлежит ни одному экрану. */}
              <InAppMessageToast />
              {/* Один диалог подтверждения на всё приложение, см. src/components/ConfirmDialog. */}
              <ConfirmDialogHost />
            </ThemeProvider>
          </SafeAreaProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
});
