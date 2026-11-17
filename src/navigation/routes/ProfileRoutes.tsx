import { SLIDE_PAGE } from '@/components/SlidePage/screenOptions';
import { ConnectionTitle } from '@/features/connection/ConnectionTitle';
import * as Screens from '@/navigation/screens';
import { Stack } from './rootStack';

const profileHeader = (title: string) => ({ headerTitle: () => <ConnectionTitle title={title} /> });

export const profileRoutes = (
  <>
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
    <Stack.Screen name="Dialogs" component={Screens.DialogsRoute} options={{ title: 'Диалоги' }} />
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
  </>
);
