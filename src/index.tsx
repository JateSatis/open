import { RequestClientContext } from '@/features/auth/RequestClientContext';
import { requestClient } from '@/api/requestClient';
import { requestSelection } from '@/api/screenRequest';
import { journalLaunchTime } from './features/recs/journal/launch';
import { QueryClientProvider } from '@tanstack/react-query';
import { registerRootComponent } from 'expo';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useLayoutEffect } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ScrollTap } from '../modules/scroll-tap';
import { ConfirmDialogHost } from '@/components/ConfirmDialog';
import { startDeviceLifecycle } from '@/features/auth/deviceLifecycle';
import { startAccountPresentation } from '@/features/auth/accountPresentation';
import { accountQueryClient } from '@/features/auth/accountQueryClient';
import { useSessionStore } from '@/features/auth/sessionStore';
import { useAuthBootstrap } from '@/features/auth/useSession';
import {
  HistoryReader,
  bindHistoryReader,
} from '@/features/chats/messages/local/reader';
import { startHistoryReadDelivery } from '@/features/chats/messages/local/readDelivery';
import { startConnectionMonitor } from '@/features/connection/connectionMonitor';
import { InAppMessageToast } from '@/features/notifications/InAppMessageToast';
import { startPersonalRealtimeEvents } from '@/features/notifications/personalRealtimeEvents';
import { startJournalLifecycle } from '@/features/recs/journal/lifecycle';
import { IncomingCallOverlay } from '@/features/streams/IncomingCallOverlay';
import { syncQueryOnlineState } from '@/lib/queryClient';
import { AppRoutes } from '@/navigation/routes/AppRoutes';
import { useIncomingLink } from '@/navigation/useIncomingLink';

bindHistoryReader(() => useSessionStore.getState().localAccountId ?? null);
SplashScreen.preventAutoHideAsync();
// The system animates the mark on entry. Reveal the ready screen without Expo's exit fade.
SplashScreen.setOptions({ duration: 0, fade: false });
startJournalLifecycle(journalLaunchTime);

export function App() {
  useEffect(startConnectionMonitor, []);
  useEffect(startDeviceLifecycle, []);
  const { localAccountId: reader, sdkStatus } = useAuthBootstrap();
  const selection = useSessionStore(requestSelection);
  const incoming = useIncomingLink();
  const api = requestClient();
  const queryClient = reader === undefined ? undefined : accountQueryClient(api);
  const requestsReady = reader === null || sdkStatus === 'session';

  useLayoutEffect(startAccountPresentation, []);
  useLayoutEffect(() => {
    if (queryClient && reader !== undefined) return startPersonalRealtimeEvents(reader, queryClient, api);
  }, [reader, queryClient, api]);
  useLayoutEffect(() => {
    if (queryClient) return syncQueryOnlineState(queryClient, requestsReady, api);
  }, [api, queryClient, requestsReady]);
  useEffect(() => {
    if (queryClient && reader !== undefined) return startHistoryReadDelivery(reader, queryClient, api);
  }, [reader, queryClient, api]);

  if (reader === undefined || !queryClient) return null;
  return (
    // Нужен react-native-gesture-handler в принципе (им пользуется шит выбора
    // медиа) — без корневой обёртки жесты не работают на Android.
    <GestureHandlerRootView style={styles.flex}>
      {/* Высота клавиатуры кадр в кадр с системной анимацией — в том числе
          внутри окна Modal на Android, где живёт шит выбора медиа. */}
      <KeyboardProvider>
        <SafeAreaProvider>
          <RequestClientContext.Provider value={api}>
            <QueryClientProvider client={queryClient}>
              <HistoryReader.Provider value={reader}>
                <ScrollTap style={styles.flex}>
                  {/* Смена владельца сбрасывает стек и локальное состояние экранов. */}
                  <AppRoutes key={selection} incoming={incoming} />
                </ScrollTap>
                {/* Входящий звонок — своим окном поверх всего, включая нативные вкладки. */}
                <IncomingCallOverlay />
                {/* Поверх навигатора: уведомление не принадлежит ни одному экрану. */}
                <InAppMessageToast />
                {/* Один диалог подтверждения на всё приложение, см. src/components/ConfirmDialog. */}
                <ConfirmDialogHost />
              </HistoryReader.Provider>
            </QueryClientProvider>
          </RequestClientContext.Provider>
        </SafeAreaProvider>
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
