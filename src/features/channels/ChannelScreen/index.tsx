import { useQueryClient } from '@tanstack/react-query';
import { useIsFocused, useRouteParams, useNavigation, useRouter } from '@/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, useWindowDimensions, View } from 'react-native';
import { useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';

import { styles } from './styles';

import type { Channel } from '@/api/channels';
import type { ChannelRef } from '@/api/chats';
import { LoadFailed } from '@/components/LoadFailed';
import { PlainPageBar } from '@/components/PageBar';
import { SlidePage, useSlideBack, type SlideBack } from '@/components/SlidePage';
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
import { closeMediaSheet } from '@/features/chats/MediaPickerSheet';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { popSheetSection } from '@/features/pops/popSheetSection';
import { useCanPublish } from '@/features/pops/queries';
import { PopsSection } from '@/features/pops/PopsSection';
import { initialSectionOf, sectionRequestOf, type SectionRequest } from '@/features/channels/sectionRequest';
import { formatUsername } from '@/features/profile/username';
import { useTheme } from '@/hooks/use-theme';
import { reloadMissing, loadStateOf } from '@/lib/loadState';

const SECTIONS = ['Посты', 'Попсы'] as const;
const SECTION_KEYS: readonly ChannelSection[] = ['posts', 'pops'];

/**
 * Экран канала: под шапкой — «Посты» | «Попсы», разделы листаются свайпом и
 * тапом по сегменту. «Посты» — переписка чата постов, «Попсы» — сетка попсов канала.
 *
 * Экран — страница (`SlidePage`): уезжает свайпом вправо за пальцем. С
 * «Попсов» свайп вправо сначала листает на «Посты», с «Постов» — уводит
 * страницу. Под ней пусто (холодный старт ссылкой) — назад ведёт в «Чаты».
 */
export function ChannelScreen() {
  const params = useRouteParams<'Channel'>();
  const { channelId } = params;
  const section = initialSectionOf(params);
  const sectionRequest = sectionRequestOf(params);
  const theme = useTheme();
  const queryClient = useQueryClient();
  const query = useChannel(channelId);
  const channel = query.data;
  const state = loadStateOf(query);
  const router = useRouter();
  const toChats = useCallback(() => router.replace({ name: 'Tabs', params: { screen: 'chats' } }), [router]);
  // Одна на маршрут: заглушка и разделы въезжают и уходят одним движением.
  const slide = useSlideBack(toChats);

  if (!channel) {
    return (
      <SlidePage slide={slide}>
        <PlainPageBar title="Канал" onBack={slide.close} />
        <View style={[styles.centered, { backgroundColor: theme.background }]}>
          {channel === null ? (
            <Text color="textSecondary">Канал недоступен</Text>
          ) : state === 'paused' ? (
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
      </SlidePage>
    );
  }

  return (
    <ChannelSections
      slide={slide}
      channel={channel}
      initialIndex={SECTION_KEYS.indexOf(sectionRequest?.section ?? section)}
      sectionRequest={sectionRequest}
      searchOpen={params.search === '1'}
    />
  );
}

type ChannelSectionsProps = {
  slide: SlideBack;
  channel: Channel;
  initialIndex: number;
  searchOpen: boolean;
  sectionRequest?: SectionRequest;
};

function ChannelSections({ slide, channel, initialIndex, sectionRequest, searchOpen }: ChannelSectionsProps) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const currentUserId = useCurrentUserId();
  const focused = useIsFocused();
  const position = useSharedValue(initialIndex);
  const [index, setIndex] = useState(initialIndex);
  // Тянуть страницу можно с «Постов»: с «Попсов» свайп вправо листает назад.
  const canSwipeBack = useDerivedValue(() => position.value < 0.01);
  const { makeSwipe } = slide;
  const swipeBack = useMemo(() => makeSwipe(canSwipeBack), [canSwipeBack, makeSwipe]);
  const { subscription } = useChannelSubscription(channel.id);
  const navigation = useNavigation();
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
            name: 'PopEditor',
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

  // Уже открытый экран, к которому вернулись с запросом раздела
  // (имя канала в просмотре попсов — «Попсы»),
  // переключается. Ключ прошлого запроса остаётся в адресе, но ждём нового —
  // раздел, выбранный после, прежний не трогает.
  const requestKey = sectionRequest?.key;
  const requestedIndex = sectionRequest ? SECTION_KEYS.indexOf(sectionRequest.section) : -1;
  const [handledRequest, setHandledRequest] = useState(requestKey);

  if (requestKey !== handledRequest) {
    setHandledRequest(requestKey);
    if (requestKey) setIndex(requestedIndex);
  }

  useEffect(() => {
    if (requestKey) position.set(withTiming(requestedIndex, { duration: SECTION_SETTLE_MS }));
  }, [position, requestKey, requestedIndex]);

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
        router.push({
          name: 'ChannelInfo',
          params: { channelId: channel.id },
        }),
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
    <SlidePage slide={slide} swipe={swipeBack}>
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
          waitFor={swipeBack}
        />

        <SubscribeBar channelId={channel.id} section={SECTION_KEYS[index]} />
      </View>
    </SlidePage>
  );
}
