import type { Channel, ChannelInfoSummary } from '@/api/channels';
import type { InfoTab } from '@/components/InfoPage';
import { subscribersLabel } from '@/features/channels/subscriberText';
import { MediaTab } from '@/features/chats/ChatInfoPage/MediaTab';
import { mediaSummary, voicesSummary } from '@/features/chats/ChatInfoPage/summaries';
import { VoicesTab } from '@/features/chats/ChatInfoPage/VoicesTab';
import { plural } from '@/lib/plural';

import { PopsTab } from './PopsTab';
import { SubscribersTab } from './SubscribersTab';

export function popsSummary(count: number): string {
  return `${count} ${plural(count, 'поп', 'попса', 'попсов')}`;
}

export type ChannelInfoTabsInput = {
  channel: Channel;
  summary: ChannelInfoSummary | undefined;
  isOwner: boolean;
  online: Set<string>;
  subscriberQuery: string | null;
  onOpenPerson: (userId: string) => void;
  onShowInChat: (messageId: string, createdAt: string) => void;
  onSearchSubscribers: () => void;
};

/**
 * Вкладки страницы канала: Подписчики (только владельцу), Попсы, Медиа,
 * Голосовые. Пустые не показываются; медиа и голосовые — из постов.
 */
export function channelInfoTabs(input: ChannelInfoTabsInput): InfoTab[] {
  const { channel, summary } = input;
  const tabs: InfoTab[] = [];
  const photos = summary?.photos ?? 0;
  const videos = summary?.videos ?? 0;

  if (input.isOwner && channel.subscribersCount > 0) {
    tabs.push({
      key: 'subscribers',
      title: 'Подписчики',
      summary: subscribersLabel(channel.subscribersCount),
      onSearch: input.onSearchSubscribers,
      render: (tab) => (
        <SubscribersTab
          tab={tab}
          channelId={channel.id}
          online={input.online}
          query={input.subscriberQuery}
          onOpenPerson={input.onOpenPerson}
        />
      ),
    });
  }

  if ((summary?.pops ?? 0) > 0) {
    tabs.push({
      key: 'pops',
      title: 'Попсы',
      summary: popsSummary(summary?.pops ?? 0),
      render: (tab) => <PopsTab tab={tab} channelId={channel.id} />,
    });
  }

  if (photos + videos > 0) {
    tabs.push({
      key: 'media',
      title: 'Медиа',
      summary: mediaSummary(photos, videos),
      render: (tab) => (
        <MediaTab tab={tab} chatId={channel.postsChatId} onShowInChat={input.onShowInChat} />
      ),
    });
  }

  if ((summary?.voices ?? 0) > 0) {
    tabs.push({
      key: 'voices',
      title: 'Голосовые',
      summary: voicesSummary(summary?.voices ?? 0),
      render: (tab) => (
        <VoicesTab tab={tab} chatId={channel.postsChatId} onShowInChat={input.onShowInChat} />
      ),
    });
  }

  return tabs;
}
