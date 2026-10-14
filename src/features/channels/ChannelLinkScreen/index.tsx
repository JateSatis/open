import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { findChannelByUsername } from '@/api/channels';
import { InfoBarButton } from '@/components/InfoPage';
import { LoadFailed } from '@/components/LoadFailed';
import { Text } from '@/components/Text';
import { useSession } from '@/features/auth/useSession';
import { useTheme } from '@/hooks/use-theme';
import { loadStateOf } from '@/lib/loadState';
import { setPendingLink } from '@/store/pendingLink';
import { InfoPageSizes, Spacing } from '@/theme';

export const channelLinkQueryKey = (username: string) =>
  ['channelLink', username.toLowerCase()] as const;

export type ChannelLinkScreenProps = { username: string };

/**
 * Ссылка на канал по `@имени`: пока ищем — крутилка, нашли — экран канала
 * вместо этого, нет такого — «Канал не найден» со стрелкой назад. Без сессии
 * ссылка откладывается до входа (`pendingLink`).
 */
export function ChannelLinkScreen({ username }: ChannelLinkScreenProps) {
  const { isAuthenticated, isLoading } = useSession();
  const signedOut = !isLoading && !isAuthenticated;

  // Без сессии ссылка ждёт входа: после него вход ведёт по ней, а не в «Чаты».
  useEffect(() => {
    if (signedOut) setPendingLink(`/c/${encodeURIComponent(username)}`);
  }, [signedOut, username]);

  if (isLoading) return null;

  if (signedOut) return <Redirect href="/(auth)/sign-in" />;

  return <ChannelLinkResolver username={username} />;
}

function ChannelLinkResolver({ username }: ChannelLinkScreenProps) {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: channelLinkQueryKey(username),
    queryFn: () => findChannelByUsername(username),
    // Имя могли отдать другому каналу: старый ответ не переиспользуем.
    staleTime: 0,
    gcTime: 0,
  });
  const state = loadStateOf(query);
  const channelId = query.data;

  // Нашли — экран канала вместо этого. Под ссылкой уже есть вкладки — снять
  // её и открыть канал в их «Чатах»: `replace` поставил бы на её место
  // второй экземпляр вкладок, и «назад» из канала было бы некуда. Холодный
  // старт — под ссылкой ничего, тогда замена (под каналом встанут «Чаты»).
  useEffect(() => {
    if (!channelId) return;

    const href = { pathname: '/chats/channel/[channelId]', params: { channelId } } as const;

    if (router.canGoBack()) {
      router.back();
      router.push(href);
    } else {
      router.replace(href);
    }
  }, [channelId, router]);

  if (channelId) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <ActivityIndicator accessibilityLabel="Открываем канал" />
      </View>
    );
  }

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/chats');
  };

  return (
    <View
      testID="channel-link-screen"
      style={[styles.screen, { backgroundColor: theme.background, paddingTop: insets.top }]}
    >
      <View style={styles.bar}>
        <InfoBarButton
          testID="channel-link-back"
          icon={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
          accessibilityLabel="Назад"
          onPress={back}
        />
      </View>
      <View style={styles.centered}>
        {query.data === null ? (
          <>
            <Text variant="bodyBold">Канал не найден</Text>
            <Text color="textSecondary" style={styles.hint}>
              {`Канала @${username}.ch нет — возможно, его переименовали или удалили.`}
            </Text>
          </>
        ) : state === 'failed' ? (
          <LoadFailed
            message="Не удалось открыть канал"
            onRetry={() =>
              void queryClient.resetQueries({ queryKey: channelLinkQueryKey(username), exact: true })
            }
          />
        ) : state === 'paused' ? (
          <Text color="textSecondary">Нет связи</Text>
        ) : (
          <ActivityIndicator accessibilityLabel="Поиск канала" />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  bar: {
    height: InfoPageSizes.barHeight,
    paddingHorizontal: Spacing.one,
    flexDirection: 'row',
    alignItems: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  hint: {
    textAlign: 'center',
  },
});
