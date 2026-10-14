import { useMemo } from 'react';

import type { ChatParticipant } from '@/api/chats';
import { InfoPersonRow, InfoTabList, type InfoStatus } from '@/components/InfoPage';

export type MembersTabProps = {
  tab: number;
  participants: ChatParticipant[];
  currentUserId: string | null;
  ownerId: string | null;
  online: Set<string>;
  statuses: Map<string, InfoStatus | null>;
  onOpenPerson: (userId: string) => void;
};

/** Порядок участников: я, затем кто в сети, затем остальные — в порядке вступления. */
export function orderMembers(
  participants: ChatParticipant[],
  currentUserId: string | null,
  online: Set<string>,
): ChatParticipant[] {
  const rank = (person: ChatParticipant) =>
    person.id === currentUserId ? 0 : online.has(person.id) ? 1 : 2;

  return participants
    .map((person, order) => ({ person, order }))
    .sort((a, b) => rank(a.person) - rank(b.person) || a.order - b.order)
    .map(({ person }) => person);
}

/** Вкладка «Участники» группы. Тап — профиль человека. */
export function MembersTab({
  tab,
  participants,
  currentUserId,
  ownerId,
  online,
  statuses,
  onOpenPerson,
}: MembersTabProps) {
  const data = useMemo(
    () => orderMembers(participants, currentUserId, online),
    [currentUserId, online, participants],
  );

  return (
    <InfoTabList
      tab={tab}
      testID="info-members"
      data={data}
      keyExtractor={(person) => person.id}
      extraData={statuses}
      renderItem={({ item }) => (
        <InfoPersonRow
          testID={`info-member-${item.id}`}
          name={item.displayName}
          avatarUrl={item.avatarUrl}
          status={statuses.get(item.id) ?? null}
          badge={item.id === ownerId ? 'владелец' : undefined}
          onPress={() => onOpenPerson(item.id)}
        />
      )}
    />
  );
}
