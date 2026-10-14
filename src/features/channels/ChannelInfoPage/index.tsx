import * as Clipboard from 'expo-clipboard';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { ChannelInfoCards } from './ChannelInfoCards';
import { ChannelInfoMenu, type ChannelInfoMenuItem, type ChannelRole } from './ChannelInfoMenu';
import { channelInfoActions } from './channelInfoActions';
import { channelInfoTabs } from './channelInfoTabs';
import { useChannelInfoSummary } from './queries';

import type { Channel } from '@/api/channels';
import {
  InfoBarButton,
  InfoPage,
  type InfoPageHandle,
  type SlideBack,
} from '@/components/InfoPage';
import { confirm } from '@/components/ConfirmDialog/store';
import { channelLink } from '@/features/channels/channelLink';
import { subscribersLabel } from '@/features/channels/subscriberText';
import { useSubscriptionActions } from '@/features/channels/subscription';
import { useChannelChangedSignal } from '@/features/channels/useChannelChangedSignal';
import { useChannelSubscription } from '@/features/channels/useChannelSubscription';
import { JUMP_PARAM_NAMES } from '@/features/chats/jumpParams';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { useOnlineUsers } from '@/features/chats/useOnlineUsers';
import { MediaViewer } from '@/features/media';
import { showNotice } from '@/features/notifications/alertsStore';
import { useProfile } from '@/features/profile/queries';

const CLEARED_PARAMS = Object.fromEntries(
  [...JUMP_PARAM_NAMES, 'search', 'searchKey', 'section'].map((name) => [name, undefined]),
);

export type ChannelInfoPageProps = {
  channel: Channel;
  /** Въезд и уход — общие с заглушкой, пока канал грузился. */
  slideBack: SlideBack;
};

/**
 * Страница информации о канале. Кнопки, карточки и меню — по тому, кто я
 * каналу: посторонний, подписчик, читатель или владелец. Медиа и голосовые —
 * из постов, попсы — сеткой канала, подписчики — только владельцу.
 */
export function ChannelInfoPage({ channel, slideBack }: ChannelInfoPageProps) {
  const router = useRouter();
  const navigation = useNavigation();
  const currentUserId = useCurrentUserId();
  const online = useOnlineUsers(currentUserId);
  const channelId = channel.id;
  const isOwner = currentUserId !== null && channel.ownerId === currentUserId;
  const { status, subscription } = useChannelSubscription(channelId);
  const role: ChannelRole = isOwner ? 'owner' : status;
  const subscriptionActions = useSubscriptionActions(channelId);
  const summaryQuery = useChannelInfoSummary(channelId);
  const summary = summaryQuery.data;
  const { data: owner } = useProfile(channel.ownerId ?? undefined);
  const [page, setPage] = useState<InfoPageHandle | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  // Подписался на этой странице: карточка ведёт к «Добавить в чаты».
  const [justSubscribed, setJustSubscribed] = useState(false);
  // Поиск подписчиков: `null` — закрыт.
  const [subscriberQuery, setSubscriberQuery] = useState<string | null>(null);

  // Владелец сменил название, фото, описание — и у подписчика страница с новым.
  useChannelChangedSignal(channelId, channel.postsChatId);

  const openPerson = useCallback(
    (personId: string) => {
      if (personId === currentUserId) {
        router.navigate('/profile');
        return;
      }

      router.push({ pathname: '/chats/people/[userId]', params: { userId: personId } });
    },
    [currentUserId, router],
  );

  // В тот же канал ниже в стеке — на «Посты», с прыжком к посту или в поиск.
  const { close } = slideBack;
  const toPosts = useCallback(
    (params: Record<string, string>) => {
      const state = navigation.getState();
      const below = state?.routes.findIndex(
        (route) =>
          route.name === 'channel/[channelId]' &&
          (route.params as { channelId?: string } | undefined)?.channelId === channelId,
      );

      if (state && below !== undefined && below !== -1) {
        navigation.dispatch({
          type: 'SET_PARAMS',
          payload: { params: { ...CLEARED_PARAMS, channelId, ...params } },
          source: state.routes[below].key,
        });
        close();
        return;
      }

      router.push({ pathname: '/chats/channel/[channelId]', params: { channelId, ...params } });
    },
    [channelId, close, navigation, router],
  );

  const showInChat = useCallback(
    (messageId: string, createdAt: string) =>
      toPosts({ jumpTo: messageId, jumpAt: createdAt, jumpKey: String(Date.now()) }),
    [toPosts],
  );
  const searchPosts = useCallback(
    () => toPosts({ search: '1', searchKey: String(Date.now()) }),
    [toPosts],
  );

  const openSubscribers = useCallback(() => page?.focusTab('subscribers'), [page]);
  const searchSubscribers = useCallback(() => {
    page?.focusTab('subscribers');
    setSubscriberQuery((current) => current ?? '');
  }, [page]);
  const closeSubscriberSearch = useCallback(() => setSubscriberQuery(null), []);

  const onCopied = useCallback(() => showNotice('Скопировано'), []);

  const subscribe = useCallback(async () => {
    if (await subscriptionActions.subscribe(false)) setJustSubscribed(true);
  }, [subscriptionActions]);

  const unsubscribe = useCallback(async () => {
    const confirmed = await confirm({
      title: 'Отписаться от канала?',
      message:
        role === 'reader'
          ? 'Канал уйдёт из «Чатов», новые посты перестанут приходить.'
          : 'Канал перестанет быть в ваших подписках.',
      confirmLabel: 'Отписаться',
      cancelLabel: 'Отмена',
      destructive: true,
    });

    if (!confirmed) return;

    setJustSubscribed(false);
    await subscriptionActions.unsubscribe();
  }, [role, subscriptionActions]);

  const selectMenu = useCallback(
    (item: ChannelInfoMenuItem) => {
      switch (item) {
        case 'search_posts':
          searchPosts();
          return;
        case 'copy_link':
          void Clipboard.setStringAsync(channelLink(channel.username)).then(() =>
            showNotice('Ссылка скопирована'),
          );
          return;
        case 'subscribers':
          openSubscribers();
          return;
        case 'unsubscribe':
          void unsubscribe();
          return;
      }
    },
    [channel.username, openSubscribers, searchPosts, unsubscribe],
  );

  const actions = channelInfoActions(role, subscription, {
    onNewPop: () => router.push({ pathname: '/pop-editor/[channelId]', params: { channelId } }),
    onSubscribers: openSubscribers,
    onSetInChats: (value) => void subscriptionActions.setInChats(value),
    onSetNotify: (value) => void subscriptionActions.setNotify(value),
    onUnsubscribe: () => void unsubscribe(),
  });

  const tabs = channelInfoTabs({
    channel,
    summary,
    isOwner,
    online,
    subscriberQuery,
    onOpenPerson: openPerson,
    onShowInChat: showInChat,
    onSearchSubscribers: searchSubscribers,
  });

  return (
    <>
      <InfoPage
        ref={setPage}
        testID="channel-info-page"
        slideBack={slideBack}
        title={channel.title}
        status={{ text: subscribersLabel(channel.subscribersCount) }}
        avatar={{ kind: 'single', uri: channel.avatarUrl, name: channel.title }}
        actions={actions}
        cards={
          <ChannelInfoCards
            channel={channel}
            role={role}
            justSubscribed={justSubscribed}
            owner={owner}
            summaryFailed={summary === undefined && summaryQuery.isError}
            onRetrySummary={() => void summaryQuery.refetch()}
            onCopied={onCopied}
            onSubscribe={() => void subscribe()}
            onAddToChats={() => void subscriptionActions.setInChats(true)}
            onOpenPerson={openPerson}
            onOpenSubscribers={openSubscribers}
          />
        }
        tabs={tabs}
        onOpenPhoto={channel.avatarUrl ? () => setPhotoOpen(true) : undefined}
        search={
          subscriberQuery === null
            ? null
            : {
                value: subscriberQuery,
                onChangeText: setSubscriberQuery,
                onClose: closeSubscriberSearch,
                placeholder: 'Поиск подписчиков',
              }
        }
        barRight={
          <>
            {isOwner ? (
              <InfoBarButton
                testID="info-edit"
                icon={{ ios: 'pencil', android: 'edit', web: 'edit' }}
                accessibilityLabel="Изменить"
                onPress={() =>
                  router.push({ pathname: '/chats/channel-edit/[channelId]', params: { channelId } })
                }
              />
            ) : null}
            <ChannelInfoMenu role={role} onSelect={selectMenu} />
          </>
        }
      />
      {channel.avatarUrl ? (
        <MediaViewer
          visible={photoOpen}
          items={[{ id: 'avatar', kind: 'photo', url: channel.avatarUrl }]}
          initialIndex={0}
          onClose={() => setPhotoOpen(false)}
        />
      ) : null}
    </>
  );
}
