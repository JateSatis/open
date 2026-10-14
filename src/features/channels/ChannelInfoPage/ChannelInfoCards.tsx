import type { Channel } from '@/api/channels';
import type { Profile } from '@/api/profile';
import { InfoCard, InfoLinkRow, InfoPersonRow, InfoTextRow } from '@/components/InfoPage';
import { formatCount } from '@/features/channels/subscriberText';
import { TabStatus } from '@/features/chats/ChatInfoPage/TabStatus';
import { formatUsername } from '@/features/profile/username';

import type { ChannelRole } from './ChannelInfoMenu';
import { ChannelSubscribeCard } from './ChannelSubscribeCard';

export type ChannelInfoCardsProps = {
  channel: Channel;
  role: ChannelRole;
  /** Подписался только что, на этой странице: карточка ведёт дальше, к «Чатам». */
  justSubscribed: boolean;
  owner: Profile | undefined;
  summaryFailed: boolean;
  onRetrySummary: () => void;
  onCopied: () => void;
  onSubscribe: () => void;
  onAddToChats: () => void;
  onOpenPerson: (userId: string) => void;
  onOpenSubscribers: () => void;
};

/**
 * Карточки под шапкой страницы канала: главное действие (подписка
 * постороннего, сводка подписчиков владельцу) и информация — описание,
 * `@имя.ch`, владелец.
 */
export function ChannelInfoCards({
  channel,
  role,
  justSubscribed,
  owner,
  summaryFailed,
  onRetrySummary,
  onCopied,
  onSubscribe,
  onAddToChats,
  onOpenPerson,
  onOpenSubscribers,
}: ChannelInfoCardsProps) {
  const description = channel.description?.trim();
  const link = formatUsername(channel.username, 'channel');
  const ownerId = channel.ownerId;
  const showSubscribe = role === 'none' || (role === 'subscriber' && justSubscribed);

  return (
    <>
      {/* Без сводки не понять, какие вкладки показывать, — честно сказать. */}
      {summaryFailed ? (
        <TabStatus state="failed" what="попсы и медиа" onRetry={onRetrySummary} />
      ) : null}
      {showSubscribe ? (
        <ChannelSubscribeCard
          subscribed={role === 'subscriber'}
          onSubscribe={onSubscribe}
          onAddToChats={onAddToChats}
        />
      ) : null}
      {role === 'owner' ? (
        <InfoCard testID="info-owner-card">
          <InfoLinkRow
            testID="info-subscribers-summary"
            icon={{ ios: 'person.2', android: 'group', web: 'group' }}
            label={`Подписчики: ${formatCount(channel.subscribersCount)} · Читатели: ${formatCount(channel.readersCount)}`}
            onPress={onOpenSubscribers}
          />
        </InfoCard>
      ) : null}
      <InfoCard testID="info-card">
        {description ? (
          <InfoTextRow
            testID="info-description"
            value={description}
            caption="Описание"
            onCopied={onCopied}
          />
        ) : null}
        {link ? (
          <InfoTextRow
            testID="info-channel-username"
            value={link}
            caption="Ссылка"
            onCopied={onCopied}
          />
        ) : null}
        {ownerId && owner ? (
          <InfoPersonRow
            testID="info-channel-owner"
            name={owner.displayName ?? 'Без имени'}
            avatarUrl={owner.avatarUrl}
            status={{ text: 'Владелец' }}
            onPress={() => onOpenPerson(ownerId)}
          />
        ) : null}
      </InfoCard>
    </>
  );
}
