import { Redirect, Tabs } from 'expo-router';

import { useSession } from '@/features/auth/useSession';
import { useBirthDateGate } from '@/features/privacy/queries';

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
  const gate = useBirthDateGate();

  // Вкладки не показываются, пока неизвестно, указана ли дата рождения: иначе
  // новый аккаунт на миг увидел бы «Чаты» перед экраном даты.
  if (isLoading || (isAuthenticated && gate === 'loading')) {
    return null;
  }

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (gate === 'required') {
    return <Redirect href="/birth-date" />;
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
