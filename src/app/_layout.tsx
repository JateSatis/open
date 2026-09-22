import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ConfirmDialogHost } from '@/components/ConfirmDialog';
import { ConnectionWatcher } from '@/features/connection/ConnectionWatcher';
import {
  reportRequestFailed,
  reportRequestSucceeded,
} from '@/features/connection/connectionStore';
import { InAppMessageToast } from '@/features/notifications/InAppMessageToast';
import { isNetworkError } from '@/lib/network';

SplashScreen.preventAutoHideAsync();

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
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <BottomSheetModalProvider>
              <ConnectionWatcher />
              <Stack screenOptions={{ headerShown: false }} />
              {/* Поверх навигатора: уведомление не принадлежит ни одному экрану. */}
              <InAppMessageToast />
              {/* Один диалог подтверждения на всё приложение, см. src/components/ConfirmDialog. */}
              <ConfirmDialogHost />
            </BottomSheetModalProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
});
