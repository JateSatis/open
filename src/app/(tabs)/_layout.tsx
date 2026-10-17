import { Redirect, Tabs } from 'expo-router';

import { useSession } from '@/features/auth/useSession';

// Вкладки слева направо — Лента, Чаты, Профиль, а открываются «Чаты»:
// и при запуске, и «назад» с другой вкладки ведёт к ним.
export const unstable_settings = { initialRouteName: 'chats' };

/**
 * Вкладки — JS-навигатор без своей панели: панель (`TabBar`) рисуют корневые
 * экраны вкладок поверх содержимого. Нативная панель так не умеет — у неё
 * сплошной фон, и экран кончается над ней.
 */
export default function TabsLayout() {
  const { isAuthenticated, isLoading } = useSession();

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return (
    <Tabs
      backBehavior="initialRoute"
      tabBar={() => null}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="feed" />
      <Tabs.Screen name="chats" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
