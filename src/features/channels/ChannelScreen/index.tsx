import { useQueryClient } from '@tanstack/react-query';
import { Stack, useIsFocused, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, useWindowDimensions, View } from 'react-native';
import { useSharedValue, withTiming } from 'react-native-reanimated';

import { styles } from './styles';

import type { Channel } from '@/api/channels';
import type { ChannelRef } from '@/api/chats';
import { LoadFailed } from '@/components/LoadFailed';
import { SegmentedControl } from '@/components/SegmentedControl';
import { Text } from '@/components/Text';
import { ChannelMenu } from '@/features/channels/ChannelMenu';
import { SECTION_SETTLE_MS, SectionPager } from '@/features/channels/SectionPager';
import { SubscribeBar } from '@/features/channels/SubscribeBar';
import { readersLabel, subscribersLabel } from '@/features/channels/subscriberText';
import { useChannelSubscription } from '@/features/channels/useChannelSubscription';
import type { ChannelSection } from '@/features/channels/useMarkChannelSectionRead';
import { channelQueryKey, useChannel } from '@/features/channels/useChannel';
import type { Pop } from '@/api/pops';
import { ChatConversation } from '@/features/chats/ChatConversation';
import { closeMediaSheet } from '@/features/chats/MediaPickerSheet';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { popSheetSection } from '@/features/pops/popSheetSection';
import { useCanPublish } from '@/features/pops/queries';
import { PopsSection } from '@/features/pops/PopsSection';
import { useTheme } from '@/hooks/use-theme';
import { reloadMissing, loadStateOf } from '@/lib/loadState';

const SECTIONS = ['Посты', 'Попсы'] as const;
const SECTION_KEYS: readonly ChannelSection[] = ['posts', 'pops'];

export type ChannelScreenProps = {
  channelId: string;
  /** С какого раздела открыть. Из «Чатов» — тот, где свежее непрочитанное. */
  section?: ChannelSection;
};

/**
 * Экран канала: под шапкой — «Посты» | «Попсы», разделы листаются свайпом и
 * тапом по сегменту. «Посты» — переписка чата постов, «Попсы» — сетка попсов канала.
 */
export function ChannelScreen({ channelId, section = 'posts' }: ChannelScreenProps) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const query = useChannel(channelId);
  const channel = query.data;
  const state = loadStateOf(query);

  if (!channel) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <Stack.Screen options={{ title: 'Канал' }} />
        {state === 'paused' ? (
          // Без сети запрос стоит на паузе: крутилка обещала бы данные, которых не будет.
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
    );
  }

  return <ChannelSections channel={channel} initialIndex={SECTION_KEYS.indexOf(section)} />;
}

function ChannelSections({ channel, initialIndex }: { channel: Channel; initialIndex: number }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const currentUserId = useCurrentUserId();
  const focused = useIsFocused();
  const position = useSharedValue(initialIndex);
  const [index, setIndex] = useState(initialIndex);
  const { subscription } = useChannelSubscription(channel.id);

  // Право публиковать — одно на канал (`can_publish_in_channel`), а не участие в чате.
  const canPublish = useCanPublish(channel.id);

  // Вкладка «Pop» шита медиа в «Постах»: попсы канала и «+ Новый поп».
  const sheetSections = useCallback(
    ({ attachPop }: { attachPop: (pop: Pop) => void }) => [
      popSheetSection({
        channelId: channel.id,
        canAdd: canPublish,
        onPick: attachPop,
        onAdd: () => {
          closeMediaSheet();
          router.push({
            pathname: '/pop-editor/[channelId]',
            params: { channelId: channel.id, from: 'posts' },
          });
        },
      }),
    ],
    [canPublish, channel.id, router],
  );

  const ref = useMemo<ChannelRef>(
    () => ({
      id: channel.id,
      title: channel.title,
      username: channel.username,
      avatarUrl: channel.avatarUrl,
    }),
    [channel],
  );

  const select = useCallback(
    (next: number) => {
      setIndex(next);
      position.set(withTiming(next, { duration: SECTION_SETTLE_MS }));
    },
    [position],
  );

  // Подпись шапки — по разделу: у «Постов» читатели, у «Попсов» все подписчики.
  const subtitle =
    index === 0 ? readersLabel(channel.readersCount) : subscribersLabel(channel.subscribersCount);
  const isOwner = currentUserId !== null && channel.ownerId === currentUserId;
  const channelHeader = useMemo(
    () => ({ subtitle, right: <ChannelMenu channelId={channel.id} isOwner={isOwner} /> }),
    [channel.id, isOwner, subtitle],
  );

  const pages = useMemo(
    () => [
      <ChatConversation
        key="posts"
        chatId={channel.postsChatId}
        channel={ref}
        active={index === 0}
        sheetSections={sheetSections}
        channelHeader={channelHeader}
      />,
      <PopsSection key="pops" channelId={channel.id} active={focused && index === 1} />,
    ],
    [channel.id, channel.postsChatId, channelHeader, focused, index, ref, sheetSections],
  );

  // Непрочитанное подписчика по разделам; у постороннего и публикующего его нет.
  const badges = useMemo(
    () => (subscription ? [subscription.unreadPosts, subscription.unreadPops] : undefined),
    [subscription],
  );

  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      <View style={styles.segments}>
        <SegmentedControl
          segments={SECTIONS}
          position={position}
          selectedIndex={index}
          onSelect={select}
          badges={badges}
        />
      </View>

      <SectionPager
        position={position}
        width={width}
        pages={pages}
        index={index}
        onIndexChange={setIndex}
      />

      <SubscribeBar channelId={channel.id} section={SECTION_KEYS[index]} />
    </View>
  );
}
