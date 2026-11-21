import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { type ReactElement, useCallback, useEffect, useState } from 'react';
import { useColorScheme, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

import { useAuthBootstrap } from '@/features/auth/useSession';
import { ChatsScreen } from '@/features/chats/ChatsScreen';
import { FeedScreen } from '@/features/feed/FeedScreen';
import { useBirthDateGate } from '@/features/privacy/queries';
import { MyProfileScreen } from '@/features/profile/MyProfileScreen';
import { splashHidden as onJournalSplashHidden } from '@/features/recs/journal/appSession';
import { navigationRef, router, trackScreen } from '@/navigation';
import type { TabsParams } from '@/navigation/types';
import { prepareLiveKit } from '@/features/streams/livekitGlobals';
import { CallScreen } from '@/features/streams/CallScreen';
import { MediaLabScreen } from '@/features/media/MediaLabScreen';
import { MosaicLabScreen } from '@/features/chats/MosaicLabScreen';
import type { IncomingLink } from '@/navigation/useIncomingLink';
import { authRoutes } from './AuthRoutes';
import { chatsRoutes } from './ChatsRoutes';
import { feedRoutes } from './FeedRoutes';
import { profileRoutes } from './ProfileRoutes';
import { hidden, Stack } from './rootStack';
import { StartupScreenLayout } from './StartupScreenLayout';

const callId = () => 'active-call';
const Tabs = createBottomTabNavigator<TabsParams>();

const FIRST_TAP_WINDOW_MS = 1000;
// Смена фазы или владельца перемонтирует навигацию, но нативная заставка одна.
let hideSplash: Promise<void> | undefined;

type ScreenLayout = (props: { children: ReactElement; route: { name: string } }) => ReactElement;

function MainTabs({
  splashHidden,
  screenLayout,
}: {
  splashHidden: boolean;
  screenLayout: ScreenLayout;
}) {
  const [laidOut, setLaidOut] = useState(false);

  useEffect(() => {
    if (!splashHidden || !laidOut) return;

    let delay: ReturnType<typeof setTimeout> | undefined;
    let idle: number | undefined;
    // onLayout и hideAsync ещё не означают, что кадр показан. Даём пройти
    // кадру, уходу заставки и первому нажатию, затем ждём свободного JS.
    const frame = requestAnimationFrame(() => {
      delay = setTimeout(() => {
        idle = requestIdleCallback(prepareLiveKit);
      }, FIRST_TAP_WINDOW_MS);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(delay);
      if (idle !== undefined) cancelIdleCallback(idle);
    };
  }, [splashHidden, laidOut]);

  return (
    <View style={{ flex: 1 }} onLayout={() => setLaidOut(true)}>
      <Tabs.Navigator
        screenLayout={screenLayout}
        initialRouteName="chats"
        backBehavior="initialRoute"
        tabBar={() => null}
        screenOptions={{ headerShown: false }}
      >
        <Tabs.Screen name="feed" component={FeedScreen} />
        <Tabs.Screen name="chats" component={ChatsScreen} />
        <Tabs.Screen name="profile" component={MyProfileScreen} />
      </Tabs.Navigator>
    </View>
  );
}

export function AppRoutes({ incoming = null }: { incoming?: IncomingLink | null }) {
  const { localAccountId } = useAuthBootstrap();
  const gate = useBirthDateGate(localAccountId);
  const [splashHidden, setSplashHidden] = useState(false);
  const theme = useColorScheme() === 'dark' ? DarkTheme : DefaultTheme;
  const phase =
    localAccountId === undefined || (localAccountId !== null && gate === 'loading')
      ? 'loading'
      : localAccountId === null
        ? 'SignIn'
        : gate === 'ok'
          ? 'Tabs'
          : 'BirthDate';

  const onScreenReady = useCallback(() => {
    hideSplash ??= SplashScreen.hideAsync();
    void hideSplash.then(() => {
      onJournalSplashHidden();
      setSplashHidden(true);
    });
  }, []);
  const screenLayout: ScreenLayout = useCallback(
    ({ children, route }) =>
      route.name === 'Tabs' ? (
        children
      ) : (
        <StartupScreenLayout onReady={onScreenReady}>{children}</StartupScreenLayout>
      ),
    [onScreenReady],
  );

  const deliver = useCallback(() => {
    if (!incoming || phase === 'loading') return;
    if (incoming.owner && incoming.owner !== localAccountId) {
      incoming.take();
      return;
    }
    const { destination } = incoming;
    if (!navigationRef.isReady()) return;
    if (destination.name === 'SignIn' || destination.name === 'BirthDate') {
      if (incoming.take() && phase === 'Tabs')
        router.navigate({ name: 'Tabs', params: { screen: 'chats' } });
      return;
    }
    if (!navigationRef.getRootState()?.routeNames.includes(destination.name)) return;
    if (incoming.take()) router.push(destination);
  }, [incoming, phase, localAccountId]);

  useEffect(deliver, [deliver]);
  if (phase === 'loading') return null;
  return (
    <NavigationContainer
      key={phase}
      ref={navigationRef}
      theme={theme}
      onReady={() => {
        trackScreen();
        deliver();
      }}
      onStateChange={trackScreen}
    >
      <Stack.Navigator initialRouteName={phase} screenLayout={screenLayout}>
        {phase !== 'Tabs' ? (
          authRoutes[phase]
        ) : (
          <Stack.Group>
            <Stack.Screen name="Tabs" options={hidden}>
              {() => <MainTabs splashHidden={splashHidden} screenLayout={screenLayout} />}
            </Stack.Screen>
            <Stack.Screen
              name="Call"
              getId={callId}
              component={CallScreen}
              options={{
                ...hidden,
                presentation: 'fullScreenModal',
                animation: 'slide_from_bottom',
              }}
            />
            {feedRoutes}
            {chatsRoutes}
            {profileRoutes}
          </Stack.Group>
        )}
        {phase !== 'BirthDate' && (
          <Stack.Group screenOptions={hidden}>
            <Stack.Screen name="MediaLab" component={MediaLabScreen} />
            <Stack.Screen name="MosaicLab" component={MosaicLabScreen} />
          </Stack.Group>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
