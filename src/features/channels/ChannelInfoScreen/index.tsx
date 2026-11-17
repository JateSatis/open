import { useQueryClient } from '@tanstack/react-query';
import { useRouteParams, useRouter } from '@/navigation';
import { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from './styles';

import { InfoBarButton, useSlideBack, type SlideBack } from '@/components/InfoPage';
import { LoadFailed } from '@/components/LoadFailed';
import { Text } from '@/components/Text';
import { ChannelInfoPage } from '@/features/channels/ChannelInfoPage';
import { channelQueryKey, useChannel } from '@/features/channels/useChannel';
import { useTheme } from '@/hooks/use-theme';
import { loadStateOf, reloadMissing, type LoadState } from '@/lib/loadState';

/**
 * Страница информации о канале по адресу. С экрана канала канал уже в кеше,
 * и страница стоит целиком в первом же кадре; без кеша — пустая страница со
 * стрелкой, пока канал грузится.
 */
export function ChannelInfoScreen() {
  const { channelId } = useRouteParams<'ChannelInfo'>();
  const router = useRouter();
  const query = useChannel(channelId);
  // Одна на маршрут: заглушка и страница въезжают и уходят одним движением.
  // Под страницей ничего нет — уйти в сам канал.
  const toChannel = useCallback(
    () => router.replace({ name: 'Channel', params: { channelId } }),
    [channelId, router],
  );
  const slideBack = useSlideBack(toChannel);

  if (query.data) return <ChannelInfoPage channel={query.data} slideBack={slideBack} />;

  return (
    <ChannelInfoPlaceholder
      channelId={channelId}
      state={loadStateOf(query)}
      slideBack={slideBack}
    />
  );
}

function ChannelInfoPlaceholder({
  channelId,
  state,
  slideBack,
}: {
  channelId: string;
  state: LoadState;
  slideBack: SlideBack;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { offset, close } = slideBack;
  const pageStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }, pageStyle]}
    >
      <View style={[styles.bar, { marginTop: insets.top }]}>
        <InfoBarButton
          testID="info-back"
          icon={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
          accessibilityLabel="Назад"
          onPress={close}
        />
      </View>
      <View style={styles.centered}>
        {state === 'paused' ? (
          <Text color="textSecondary">Нет связи</Text>
        ) : state === 'failed' ? (
          <LoadFailed
            message="Не удалось открыть канал"
            onRetry={() => reloadMissing(queryClient, [channelQueryKey(channelId)])}
          />
        ) : (
          <ActivityIndicator accessibilityLabel="Загрузка канала" />
        )}
      </View>
    </Animated.View>
  );
}
