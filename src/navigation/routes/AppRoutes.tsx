import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { useCallback, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

import { useSession } from '@/features/auth/useSession';
import { useBirthDateGate } from '@/features/privacy/queries';
import { navigationRef, router, trackScreen } from '@/navigation';
import { MainTabs } from '@/navigation/MainTabs';
import * as Screens from '@/navigation/screens';
import type { IncomingLink } from '@/navigation/useIncomingLink';
import { authRoutes } from './AuthRoutes';
import { chatsRoutes } from './ChatsRoutes';
import { feedRoutes } from './FeedRoutes';
import { profileRoutes } from './ProfileRoutes';
import { hidden, Stack } from './rootStack';

const callId = () => 'active-call';

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
              component={Screens.CallRoute}
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
            <Stack.Screen name="MediaLab" component={Screens.MediaLabScreen} />
            <Stack.Screen name="MosaicLab" component={Screens.MosaicLabScreen} />
          </Stack.Group>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
