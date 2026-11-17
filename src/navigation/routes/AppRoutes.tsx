import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { useCallback, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

import { useSession } from '@/features/auth/useSession';
import { ChatsScreen } from '@/features/chats/ChatsScreen';
import { FeedScreen } from '@/features/feed/FeedScreen';
import { useBirthDateGate } from '@/features/privacy/queries';
import { MyProfileScreen } from '@/features/profile/MyProfileScreen';
import { navigationRef, router, trackScreen } from '@/navigation';
import type { TabsParams } from '@/navigation/types';
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

function MainTabs() {
  return (
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
  );
}

export function AppRoutes({ incoming = null }: { incoming?: IncomingLink | null }) {
  const { session, isAuthenticated, isLoading } = useSession();
  const gate = useBirthDateGate();
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
        void SplashScreen.hideAsync();
      }}
      onStateChange={trackScreen}
    >
      <Stack.Navigator initialRouteName={phase}>
        {phase !== 'Tabs' ? (
          authRoutes[phase]
        ) : (
          <Stack.Group>
            <Stack.Screen name="Tabs" component={MainTabs} options={hidden} />
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
