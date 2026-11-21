import { journalLaunchTime } from './features/recs/journal/launch';
import { QueryClientProvider } from '@tanstack/react-query';
import { registerRootComponent } from 'expo';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useLayoutEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ScrollTap } from '../modules/scroll-tap';
import { ConfirmDialogHost } from '@/components/ConfirmDialog';
import { startDeviceLifecycle } from '@/features/auth/deviceLifecycle';
import { resetClientState } from '@/features/auth/resetClientState';
import { useSessionStore } from '@/features/auth/sessionStore';
import { useAuthBootstrap } from '@/features/auth/useSession';
import {
  HistoryReader,
  bindHistoryReader,
  useHistoryReader,
} from '@/features/chats/messages/local/reader';
import { startHistoryReadDelivery } from '@/features/chats/messages/local/readDelivery';
import { startConnectionMonitor } from '@/features/connection/connectionMonitor';
import { InAppMessageToast } from '@/features/notifications/InAppMessageToast';
import { startPersonalRealtimeEvents } from '@/features/notifications/personalRealtimeEvents';
import { startJournalLifecycle } from '@/features/recs/journal/lifecycle';
import { IncomingCallOverlay } from '@/features/streams/IncomingCallOverlay';
import { createAppQueryClient, syncQueryOnlineState } from '@/lib/queryClient';
import { AppRoutes } from '@/navigation/routes/AppRoutes';
import { type IncomingLink, useIncomingLink } from '@/navigation/useIncomingLink';

bindHistoryReader(() => useSessionStore.getState().localAccountId ?? null);
SplashScreen.preventAutoHideAsync();
// The system animates the mark on entry. Reveal the ready screen without Expo's exit fade.
SplashScreen.setOptions({ duration: 0, fade: false });
startJournalLifecycle(journalLaunchTime);

export function App() {
  useEffect(startConnectionMonitor, []);
  useEffect(startDeviceLifecycle, []);
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

  useLayoutEffect(() => startPersonalRealtimeEvents(reader, queryClient), [reader, queryClient]);
  useLayoutEffect(() => syncQueryOnlineState(queryClient, requestsReady), [queryClient, requestsReady]);
  useLayoutEffect(() => () => resetClientState(queryClient), [queryClient]);
  useEffect(() => startHistoryReadDelivery(reader, queryClient), [reader, queryClient]);

  return (
    // Нужен react-native-gesture-handler в принципе (им пользуется шит выбора
    // медиа) — без корневой обёртки жесты не работают на Android.
    <GestureHandlerRootView style={styles.flex}>
      {/* Высота клавиатуры кадр в кадр с системной анимацией — в том числе
          внутри окна Modal на Android, где живёт шит выбора медиа. */}
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <SafeAreaProvider>
            <ScrollTap style={styles.flex}>
              <AppRoutes incoming={incoming} />
            </ScrollTap>
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
