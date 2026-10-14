import type { ChatSummary, Person } from '@/api/chats';
import type { Subscription } from '@/api/subscriptions';
import {
  InfoCard,
  InfoLinkRow,
  InfoPersonRow,
  InfoTextRow,
  type InfoStatus,
} from '@/components/InfoPage';
import { formatUsername } from '@/features/profile/username';

import { SubscribeCard } from './SubscribeCard';
import { TabStatus } from './TabStatus';

export type ChatInfoCardsProps = {
  chat: ChatSummary;
  isMember: boolean;
  /** Собеседник своего диалога. */
  other: Person | null;
  otherProfile: { bio?: string | null; username?: string | null } | undefined;
  /** Двое чужого диалога. */
  pair: Person[] | null;
  statuses: Map<string, InfoStatus | null>;
  subscription: Subscription | null | undefined;
  summaryFailed: boolean;
  onRetrySummary: () => void;
  onCopied: () => void;
  onOpenPerson: (userId: string) => void;
  onAddMembers: () => void;
};

/**
 * Карточки под шапкой страницы чата: подписка постороннего, информация
 * (у группы — описание и `@имя`, у диалога — собеседник или двое) и
 * «Добавить участников» у участника группы.
 */
export function ChatInfoCards({
  chat,
  isMember,
  other,
  otherProfile,
  pair,
  statuses,
  subscription,
  summaryFailed,
  onRetrySummary,
  onCopied,
  onOpenPerson,
  onAddMembers,
}: ChatInfoCardsProps) {
  const isGroup = chat.kind === 'group';
  const groupUsername = isGroup ? formatUsername(chat.username, 'group') : null;
  const description = chat.description?.trim();
  const personUsername = other ? formatUsername(otherProfile?.username ?? null) : null;

  return (
    <>
      {/* Без сводки не понять, какие вкладки показывать, — честно сказать. */}
      {summaryFailed ? (
        <TabStatus state="failed" what="медиа и голосовые" onRetry={onRetrySummary} />
      ) : null}
      {!isMember ? (
        <SubscribeCard chatId={chat.id} isGroup={isGroup} subscription={subscription} />
      ) : null}
      {isGroup ? (
        <InfoCard testID="info-card">
          {description ? (
            <InfoTextRow
              testID="info-description"
              value={description}
              caption="Описание"
              onCopied={onCopied}
            />
          ) : null}
          {groupUsername ? (
            <InfoTextRow
              testID="info-group-username"
              value={groupUsername}
              caption="Имя группы"
              onCopied={onCopied}
            />
          ) : null}
        </InfoCard>
      ) : other ? (
        <InfoCard testID="info-card">
          {otherProfile?.bio?.trim() ? (
            <InfoTextRow
              testID="info-bio"
              value={otherProfile.bio.trim()}
              caption="О себе"
              onCopied={onCopied}
            />
          ) : null}
          {personUsername ? (
            <InfoTextRow
              testID="info-username"
              value={personUsername}
              caption="Имя пользователя"
              onCopied={onCopied}
            />
          ) : null}
        </InfoCard>
      ) : pair ? (
        <InfoCard testID="info-card">
          {pair.map((person) => (
            <InfoPersonRow
              key={person.id}
              testID={`info-person-${person.id}`}
              name={person.displayName}
              avatarUrl={person.avatarUrl}
              status={statuses.get(person.id) ?? null}
              onPress={() => onOpenPerson(person.id)}
            />
          ))}
        </InfoCard>
      ) : null}
      {isGroup && isMember ? (
        <InfoCard testID="info-add-members-card">
          <InfoLinkRow
            testID="info-add-members"
            icon={{ ios: 'person.badge.plus', android: 'person_add', web: 'person_add' }}
            label="Добавить участников"
            onPress={onAddMembers}
          />
        </InfoCard>
      ) : null}
    </>
  );
}
