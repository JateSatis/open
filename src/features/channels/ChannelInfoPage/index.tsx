import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { ChannelInfoCards } from './ChannelInfoCards';
import { ChannelInfoMenu, type ChannelInfoMenuItem, type ChannelRole } from './ChannelInfoMenu';
import { channelInfoActions } from './channelInfoActions';
import { channelInfoTabs } from './channelInfoTabs';
import { useChannelInfoSummary } from './queries';
import { useInfoSubscription } from './useInfoSubscription';
import { useToPosts } from './useToPosts';

import type { Channel } from '@/api/channels';
import {
  InfoBarButton,
  InfoPage,
  type InfoPageHandle,
  type SlideBack,
} from '@/components/InfoPage';
import { channelLink } from '@/features/channels/channelLink';
import { subscribersLabel } from '@/features/channels/subscriberText';
import { useChannelChangedSignal } from '@/features/channels/useChannelChangedSignal';
import { useChannelSubscription } from '@/features/channels/useChannelSubscription';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { MediaViewer } from '@/features/media';
import { showNotice } from '@/features/notifications/alertsStore';
import { useProfile } from '@/features/profile/queries';

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
  const currentUserId = useCurrentUserId();
  const channelId = channel.id;
  const isOwner = currentUserId !== null && channel.ownerId === currentUserId;
  const { status, subscription } = useChannelSubscription(channelId);
  const role: ChannelRole = isOwner ? 'owner' : status;
  const subscriptionActions = useInfoSubscription(channelId, role);
  const { justSubscribed, subscribe, unsubscribe } = subscriptionActions;
  const summaryQuery = useChannelInfoSummary(channelId);
  const summary = summaryQuery.data;
  const { data: owner } = useProfile(channel.ownerId ?? undefined);
  const [page, setPage] = useState<InfoPageHandle | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
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

  const { showInChat, searchPosts } = useToPosts(channelId, slideBack.close);

  const openSubscribers = useCallback(() => page?.focusTab('subscribers'), [page]);
  const searchSubscribers = useCallback(() => {
    page?.focusTab('subscribers');
    setSubscriberQuery((current) => current ?? '');
  }, [page]);
  const closeSubscriberSearch = useCallback(() => setSubscriberQuery(null), []);

  const onCopied = useCallback(() => showNotice('Скопировано'), []);

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
