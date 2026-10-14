import { useQueryClient } from '@tanstack/react-query';
import { Stack, useIsFocused, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useChannelChangedSignal } from '@/features/channels/useChannelChangedSignal';
import { useChannelSubscription } from '@/features/channels/useChannelSubscription';
import type { ChannelSection } from '@/features/channels/useMarkChannelSectionRead';
import { channelQueryKey, useChannel } from '@/features/channels/useChannel';
import type { Pop } from '@/api/pops';
import { ChatConversation } from '@/features/chats/ChatConversation';
import type { ChatSearchParams } from '@/features/chats/chatSearch/useChatSearch';
import { closeMediaSheet } from '@/features/chats/MediaPickerSheet';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { popSheetSection } from '@/features/pops/popSheetSection';
import { useCanPublish } from '@/features/pops/queries';
import { PopsSection } from '@/features/pops/PopsSection';
import { formatUsername } from '@/features/profile/username';
import { useTheme } from '@/hooks/use-theme';
import { reloadMissing, loadStateOf } from '@/lib/loadState';

const SECTIONS = ['Посты', 'Попсы'] as const;
const SECTION_KEYS: readonly ChannelSection[] = ['posts', 'pops'];

export type ChannelScreenProps = {
  channelId: string;
  /** С какого раздела открыть. Из «Чатов» — тот, где свежее непрочитанное. */
  section?: ChannelSection;
  /**
   * Ключ перехода к посту снаружи (цитата, островок, пересланный комментарий).
   * Новый ключ переключает экран на «Посты» — и уже открытый, ниже в стеке.
   */
  postsRequest?: string;
};

/**
 * Экран канала: под шапкой — «Посты» | «Попсы», разделы листаются свайпом и
 * тапом по сегменту. «Посты» — переписка чата постов, «Попсы» — сетка попсов канала.
 */
export function ChannelScreen({ channelId, section = 'posts', postsRequest }: ChannelScreenProps) {
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

  return (
    <ChannelSections
      channel={channel}
      initialIndex={postsRequest ? 0 : SECTION_KEYS.indexOf(section)}
      postsRequest={postsRequest}
    />
  );
}

type ChannelSectionsProps = { channel: Channel; initialIndex: number; postsRequest?: string };

function ChannelSections({ channel, initialIndex, postsRequest }: ChannelSectionsProps) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const currentUserId = useCurrentUserId();
  const focused = useIsFocused();
  const position = useSharedValue(initialIndex);
  const [index, setIndex] = useState(initialIndex);
  const { subscription } = useChannelSubscription(channel.id);
  const navigation = useNavigation();
  const searchOpen = useLocalSearchParams<ChatSearchParams>().search === '1';
  const searching = searchOpen && index === 0;

  // Поиск — по постам: ушли на «Попсы» — поиск закрывается, иначе шапка
  // осталась бы спрятанной, а сегменты встали бы под статус-бар.
  useEffect(() => {
    if (searchOpen && index !== 0) {
      navigation.setParams({ search: undefined, searchKey: undefined } as never);
    }
  }, [index, navigation, searchOpen]);

  // Владелец сменил название, фото, `@имя` — шапка обновляется и здесь.
  useChannelChangedSignal(channel.id, channel.postsChatId);

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

  // Прыгать к посту можно только в «Постах»: уже открытый на «Попсах» экран,
  // к которому вернулись, переключается. Ключ прошлого перехода остаётся в
  // адресе, но эффект ждёт нового — раздел, выбранный после, он не трогает.
  const [handledRequest, setHandledRequest] = useState(postsRequest);

  if (postsRequest !== handledRequest) {
    setHandledRequest(postsRequest);
    if (postsRequest) setIndex(0);
  }

  useEffect(() => {
    if (postsRequest) position.set(withTiming(0, { duration: SECTION_SETTLE_MS }));
  }, [position, postsRequest]);

  // Подпись шапки — `@имя.ch` и число по разделу: у «Постов» читатели, у
  // «Попсов» все подписчики.
  const subtitle = [
    formatUsername(channel.username, 'channel'),
    index === 0 ? readersLabel(channel.readersCount) : subscribersLabel(channel.subscribersCount),
  ]
    .filter(Boolean)
    .join(' · ');
  const isOwner = currentUserId !== null && channel.ownerId === currentUserId;
  const channelHeader = useMemo(
    () => ({
      subtitle,
      right: <ChannelMenu channelId={channel.id} isOwner={isOwner} />,
      onTitlePress: () =>
        router.push({ pathname: '/chats/channel-info/[channelId]', params: { channelId: channel.id } }),
    }),
    [channel.id, isOwner, router, subtitle],
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
      {/* Поиск по постам ставит своё поле на место шапки — сегменты над ним
          оказались бы под статус-баром. */}
      {searching ? null : (
        <View style={styles.segments}>
          <SegmentedControl
            segments={SECTIONS}
            position={position}
            selectedIndex={index}
            onSelect={select}
            badges={badges}
          />
        </View>
      )}

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
