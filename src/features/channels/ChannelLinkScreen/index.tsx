import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouteParams, Redirect, useRouter } from '@/navigation';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { findChannelByUsername } from '@/api/channels';
import { InfoBarButton } from '@/components/InfoPage';
import { LoadFailed } from '@/components/LoadFailed';
import { Text } from '@/components/Text';
import { useTheme } from '@/hooks/use-theme';
import { loadStateOf } from '@/lib/loadState';
import { InfoPageSizes, Spacing } from '@/theme';

export const channelLinkQueryKey = (username: string) =>
  ['channelLink', username.toLowerCase()] as const;

/**
 * Ссылка на канал по `@имени`: пока ищем — крутилка, нашли — экран канала
 * вместо этого, нет такого — «Канал не найден» со стрелкой назад.
 */
export function ChannelLinkScreen() {
  const api = useRequestClient();
  const { username } = useRouteParams<'ChannelLink'>();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: channelLinkQueryKey(username),
    queryFn: () => findChannelByUsername(username, api),
    // Имя могли отдать другому каналу: старый ответ не переиспользуем.
    staleTime: 0,
    gcTime: 0,
  });
  const state = loadStateOf(query);
  const channelId = query.data;

  if (channelId) {
    return <Redirect href={{ name: 'Channel', params: { channelId } }} />;
  }

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace({ name: 'Tabs', params: { screen: 'chats' } });
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
              void queryClient.resetQueries({
                queryKey: channelLinkQueryKey(username),
                exact: true,
              })
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
