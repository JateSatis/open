import { Redirect } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useSession } from '@/features/auth/useSession';
import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  const { isAuthenticated, isLoading } = useSession();
  const theme = useTheme();

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return (
    <NativeTabs
      backgroundColor={theme.background}
      indicatorColor={theme.backgroundElement}
      labelStyle={{ selected: { color: theme.text } }}>
      <NativeTabs.Trigger name="chats">
        <NativeTabs.Trigger.Label>Чаты</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="message" md="chat" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="feed">
        <NativeTabs.Trigger.Label>Лента</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="sparkles" md="dynamic_feed" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Профиль</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.crop.circle" md="person" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
