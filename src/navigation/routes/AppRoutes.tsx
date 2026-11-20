import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { useColorScheme, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

import { useSession } from '@/features/auth/useSession';
import { ChatsScreen } from '@/features/chats/ChatsScreen';
import { FeedScreen } from '@/features/feed/FeedScreen';
import { useBirthDateGate } from '@/features/privacy/queries';
import { MyProfileScreen } from '@/features/profile/MyProfileScreen';
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

const callId = () => 'active-call';
const Tabs = createBottomTabNavigator<TabsParams>();

const FIRST_TAP_WINDOW_MS = 1000;

function MainTabs({ splashHidden }: { splashHidden: boolean }) {
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
  const { session, isAuthenticated, isLoading } = useSession();
  const gate = useBirthDateGate();
  const [splashHidden, setSplashHidden] = useState(false);
  const theme = useColorScheme() === 'dark' ? DarkTheme : DefaultTheme;
  const phase =
    isLoading || (isAuthenticated && gate === 'loading')
      ? 'loading'
      : !isAuthenticated
        ? 'SignIn'
        : gate === 'required'
          ? 'BirthDate'
          : 'Tabs';

  const deliver = useCallback(() => {
    if (!incoming || phase === 'loading') return;
    if (incoming.owner && incoming.owner !== session?.user.id) {
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
  }, [incoming, phase, session?.user.id]);

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
        void SplashScreen.hideAsync().then(() => setSplashHidden(true));
      }}
      onStateChange={trackScreen}
    >
      <Stack.Navigator initialRouteName={phase}>
        {phase !== 'Tabs' ? (
          authRoutes[phase]
        ) : (
          <Stack.Group>
            <Stack.Screen name="Tabs" options={hidden}>
              {() => <MainTabs splashHidden={splashHidden} />}
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
