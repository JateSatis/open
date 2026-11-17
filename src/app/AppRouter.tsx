import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useCallback, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

import { SLIDE_PAGE } from '@/components/SlidePage/screenOptions';
import { useSession } from '@/features/auth/useSession';
import { ConnectionTitle } from '@/features/connection/ConnectionTitle';
import { useBirthDateGate } from '@/features/privacy/queries';
import { navigationRef, router, trackScreen } from '@/navigation';
import { MainTabs } from '@/navigation/MainTabs';
import * as Screens from '@/navigation/screens';
import type { RootParams } from '@/navigation/types';
import type { IncomingLink } from '@/navigation/useIncomingLink';

const Stack = createNativeStackNavigator<RootParams>();
const callId = () => 'active-call';
const hidden = { headerShown: false };
const profileHeader = (title: string) => ({ headerTitle: () => <ConnectionTitle title={title} /> });

export function AppRouter({ incoming = null }: { incoming?: IncomingLink | null }) {
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
        {phase === 'SignIn' ? (
          <Stack.Screen name="SignIn" component={Screens.SignInScreen} options={hidden} />
        ) : phase === 'BirthDate' ? (
          <Stack.Screen
            name="BirthDate"
            component={Screens.BirthDateScreen}
            options={{ ...hidden, gestureEnabled: false }}
          />
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
            <Stack.Screen name="PopEditor" component={Screens.PopEditorRoute} options={hidden} />
            <Stack.Screen
              name="PopViewer"
              component={Screens.PopViewerRoute}
              options={{
                ...hidden,
                statusBarStyle: 'light',
                contentStyle: { backgroundColor: 'black' },
              }}
            />
            <Stack.Screen
              name="ChannelLink"
              component={Screens.ChannelLinkRoute}
              options={hidden}
            />
            <Stack.Screen name="Channel" component={Screens.ChannelRoute} options={SLIDE_PAGE} />
            <Stack.Screen name="Chat" component={Screens.ChatRoute} options={SLIDE_PAGE} />
            <Stack.Screen
              name="NewChat"
              component={Screens.NewChatRoute}
              options={{ title: 'Новый чат' }}
            />
            <Stack.Screen
              name="NewChannel"
              component={Screens.NewChannelRoute}
              options={{ title: 'Новый канал' }}
            />
            <Stack.Screen
              name="Invites"
              component={Screens.InvitesRoute}
              options={{ title: 'Заявки' }}
            />
            <Stack.Screen
              name="Forward"
              component={Screens.ForwardRoute}
              options={{ title: 'Кому переслать' }}
            />
            <Stack.Screen
              name="Saved"
              component={Screens.SavedRoute}
              options={{ title: 'Сохранённые сообщения' }}
            />
            <Stack.Screen name="Person" component={Screens.PersonRoute} options={SLIDE_PAGE} />
            <Stack.Screen
              name="Friends"
              component={Screens.FriendsRoute}
              options={profileHeader('Друзья')}
            />
            <Stack.Screen
              name="MyFriends"
              component={Screens.MyFriendsRoute}
              options={profileHeader('Друзья')}
            />
            <Stack.Screen
              name="Dialogs"
              component={Screens.DialogsRoute}
              options={{ title: 'Диалоги' }}
            />
            <Stack.Screen name="Request" component={Screens.RequestRoute} options={SLIDE_PAGE} />
            <Stack.Screen
              name="ChannelInfo"
              component={Screens.ChannelInfoRoute}
              options={SLIDE_PAGE}
            />
            <Stack.Screen
              name="ChannelEdit"
              component={Screens.ChannelEditRoute}
              options={{ title: 'Изменить' }}
            />
            <Stack.Screen
              name="ChannelSubscribers"
              component={Screens.ChannelSubscribersRoute}
              options={{ title: 'Подписчики' }}
            />
            <Stack.Screen name="ChatInfo" component={Screens.ChatInfoRoute} options={SLIDE_PAGE} />
            <Stack.Screen
              name="ChatEdit"
              component={Screens.ChatEditRoute}
              options={{ title: 'Изменить' }}
            />
            <Stack.Screen
              name="ChatSubscribers"
              component={Screens.ChatSubscribersRoute}
              options={{ title: 'Подписчики' }}
            />
            <Stack.Screen
              name="ChatInvite"
              component={Screens.ChatInviteRoute}
              options={{ title: 'Добавить участников' }}
            />
            <Stack.Screen
              name="EditProfile"
              component={Screens.EditProfileRoute}
              options={profileHeader('Редактирование')}
            />
            <Stack.Screen
              name="Account"
              component={Screens.AccountRoute}
              options={profileHeader('Аккаунт')}
            />
            <Stack.Screen
              name="Privacy"
              component={Screens.PrivacyRoute}
              options={profileHeader('Конфиденциальность')}
            />
            <Stack.Screen
              name="Blocked"
              component={Screens.BlockedRoute}
              options={profileHeader('Заблокированные')}
            />
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
