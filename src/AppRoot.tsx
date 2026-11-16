import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { type ReactNode, useEffect, useLayoutEffect, useState } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ScrollTap } from '../modules/scroll-tap';

import { ConfirmDialogHost } from '@/components/ConfirmDialog';
import { AccountLifecycle } from '@/features/auth/AccountLifecycle';
import { useSession } from '@/features/auth/useSession';
import { resetClientState } from '@/features/auth/resetClientState';
import { HistoryReader, bindHistoryReader } from '@/features/chats/messages/local/reader';
import { HistoryReadDelivery } from '@/features/chats/useMarkChatRead';
import { useSessionStore } from '@/features/auth/sessionStore';
import { ConnectionWatcher } from '@/features/connection/ConnectionWatcher';
import { InAppMessageToast } from '@/features/notifications/InAppMessageToast';
import { BirthDateGate } from '@/features/privacy/BirthDateGate';
import { JournalSession } from '@/features/recs/journal/JournalSession';
import { IncomingCallOverlay } from '@/features/streams/IncomingCallOverlay';
import { BelowReturnBar, ReturnToCallBar } from '@/features/streams/ReturnToCallBar';
import { createAppQueryClient } from '@/lib/queryClient';

bindHistoryReader(() => useSessionStore.getState().session?.user.id ?? null);
SplashScreen.preventAutoHideAsync();

type AppRootProps = { children: ReactNode };

export function AppRoot({ children }: AppRootProps) {
  const { session } = useSession();
  const reader = session?.user.id ?? null;
  return (
    <HistoryReader.Provider value={reader}>
      <AccountLayout key={reader ?? 'signed-out'}>{children}</AccountLayout>
    </HistoryReader.Provider>
  );
}

function AccountLayout({ children }: AppRootProps) {
  const colorScheme = useColorScheme();
  const [queryClient] = useState(createAppQueryClient);

  useLayoutEffect(() => () => resetClientState(queryClient), [queryClient]);

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
              <HistoryReadDelivery />
              <AccountLifecycle />
              <BirthDateGate />
              <JournalSession />
              {/* Свёрнутый звонок сдвигает навигатор вниз, а не перекрывает шапки. */}
              <BelowReturnBar>
                {/* Тап по медиа в списке на хвосте прокрутки — с первого
                    касания, см. modules/scroll-tap. Окна Modal — со своей. */}
                <ScrollTap style={styles.flex}>{children}</ScrollTap>
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
