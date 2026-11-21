import { QueryClientProvider } from '@tanstack/react-query';
import { registerRootComponent } from 'expo';
import * as SplashScreen from 'expo-splash-screen';
import { useLayoutEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ScrollTap } from '../modules/scroll-tap';
import { ConfirmDialogHost } from '@/components/ConfirmDialog';
import { AccountLifecycle } from '@/features/auth/AccountLifecycle';
import { resetClientState } from '@/features/auth/resetClientState';
import { useSessionStore } from '@/features/auth/sessionStore';
import { useAuthBootstrap } from '@/features/auth/useSession';
import {
  HistoryReader,
  bindHistoryReader,
  useHistoryReader,
} from '@/features/chats/messages/local/reader';
import { HistoryReadDelivery } from '@/features/chats/useMarkChatRead';
import { ConnectionWatcher } from '@/features/connection/ConnectionWatcher';
import { InAppMessageToast } from '@/features/notifications/InAppMessageToast';
import { JournalSession } from '@/features/recs/journal/JournalSession';
import { IncomingCallOverlay } from '@/features/streams/IncomingCallOverlay';
import { BelowReturnBar, ReturnToCallBar } from '@/features/streams/ReturnToCallBar';
import { createAppQueryClient } from '@/lib/queryClient';
import { AppRoutes } from '@/navigation/routes/AppRoutes';
import { type IncomingLink, useIncomingLink } from '@/navigation/useIncomingLink';

bindHistoryReader(() => useSessionStore.getState().localAccountId ?? null);
SplashScreen.preventAutoHideAsync();
// The system animates the mark on entry. Reveal the ready screen without Expo's exit fade.
SplashScreen.setOptions({ duration: 0, fade: false });

export function App() {
  const { localAccountId: reader, sdkStatus } = useAuthBootstrap();
  const incoming = useIncomingLink();
  if (reader === undefined) return null;
  return (
    <HistoryReader.Provider value={reader}>
      <AccountLayout
        key={reader ?? 'signed-out'}
        incoming={incoming}
        requestsReady={reader === null || sdkStatus === 'session'}
      />
    </HistoryReader.Provider>
  );
}

function AccountLayout({
  incoming,
  requestsReady,
}: {
  incoming: IncomingLink | null;
  requestsReady: boolean;
}) {
  const reader = useHistoryReader();
  const [queryClient] = useState(() => createAppQueryClient(reader));

  useLayoutEffect(() => () => resetClientState(queryClient), [queryClient]);

  return (
    // Нужен react-native-gesture-handler в принципе (им пользуется шит выбора
    // медиа) — без корневой обёртки жесты не работают на Android.
    <GestureHandlerRootView style={styles.flex}>
      {/* Высота клавиатуры кадр в кадр с системной анимацией — в том числе
          внутри окна Modal на Android, где живёт шит выбора медиа. */}
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <SafeAreaProvider>
            <ConnectionWatcher requestsReady={requestsReady} />
            {requestsReady && <HistoryReadDelivery />}
            {requestsReady && <AccountLifecycle />}
            <JournalSession />
            {/* Свёрнутый звонок сдвигает навигатор вниз, а не перекрывает шапки. */}
            <BelowReturnBar>
              {/* Тап по медиа в списке на хвосте прокрутки — с первого
                    касания, см. modules/scroll-tap. Окна Modal — со своей. */}
              <ScrollTap style={styles.flex}>
                <AppRoutes incoming={incoming} />
              </ScrollTap>
            </BelowReturnBar>
            <ReturnToCallBar />
            {/* Входящий звонок — своим окном поверх всего, включая нативные вкладки. */}
            <IncomingCallOverlay />
            {/* Поверх навигатора: уведомление не принадлежит ни одному экрану. */}
            <InAppMessageToast />
            {/* Один диалог подтверждения на всё приложение, см. src/components/ConfirmDialog. */}
            <ConfirmDialogHost />
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

registerRootComponent(App);
