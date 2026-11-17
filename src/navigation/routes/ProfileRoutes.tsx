import { SLIDE_PAGE } from '@/components/SlidePage/screenOptions';
import { ConnectionTitle } from '@/features/connection/ConnectionTitle';
import { UserProfile } from '@/features/profile/UserProfile';
import { FriendsList } from '@/features/friends/FriendsList';
import { MyFriendsScreen } from '@/features/friends/MyFriendsScreen';
import { UserChats } from '@/features/profile/UserChats';
import { EditProfileScreen } from '@/features/profile/EditProfileScreen';
import { AccountScreen } from '@/features/auth/AccountScreen';
import { PrivacyScreen } from '@/features/privacy/PrivacyScreen';
import { BlockedUsersScreen } from '@/features/moderation/BlockedUsersScreen';
import { Stack } from './rootStack';

const profileHeader = (title: string) => ({ headerTitle: () => <ConnectionTitle title={title} /> });

export const profileRoutes = (
  <>
    <Stack.Screen name="Person" component={UserProfile} options={SLIDE_PAGE} />
    <Stack.Screen name="Friends" component={FriendsList} options={profileHeader('Друзья')} />
    <Stack.Screen name="MyFriends" component={MyFriendsScreen} options={profileHeader('Друзья')} />
    <Stack.Screen name="Dialogs" component={UserChats} options={{ title: 'Диалоги' }} />
    <Stack.Screen
      name="EditProfile"
      component={EditProfileScreen}
      options={profileHeader('Редактирование')}
    />
    <Stack.Screen name="Account" component={AccountScreen} options={profileHeader('Аккаунт')} />
    <Stack.Screen
      name="Privacy"
      component={PrivacyScreen}
      options={profileHeader('Конфиденциальность')}
    />
    <Stack.Screen
      name="Blocked"
      component={BlockedUsersScreen}
      options={profileHeader('Заблокированные')}
    />
  </>
);
