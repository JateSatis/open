import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { FeedScreen } from '@/features/feed/FeedScreen';
import { ChatsScreen } from '@/features/chats/ChatsScreen';
import { MyProfileScreen } from '@/features/profile/MyProfileScreen';
import type { TabsParams } from './types';

const Tabs = createBottomTabNavigator<TabsParams>();
export function MainTabs() {
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
