import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { ChatParticipant, Person } from '@/api/chats';
import { AnchoredMenu, type MenuAnchor } from '@/components/AnchoredMenu';
import { InfoPersonRow, InfoTabList, type InfoStatus } from '@/components/InfoPage';
import type { MenuAction } from '@/components/MenuList';
import { Text } from '@/components/Text';
import { normalizeSearch } from '@/features/search/searchText';
import { Spacing } from '@/theme';

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

/** Подходит ли человек под поиск: имя или `@имя` содержит запрос. */
export function matchesPerson(person: Person, query: string): boolean {
  const needle = normalizeSearch(query.trim().replace(/^@/, ''));

  if (!needle) return true;

  return (
    normalizeSearch(person.displayName).includes(needle) ||
    (person.username ? normalizeSearch(person.username).includes(needle) : false)
  );
}

type MemberRow = { person: Person; waiting: boolean };
type MemberAction = 'remove' | 'cancel';

const REMOVE: MenuAction<MemberAction> = {
  id: 'remove',
  label: 'Удалить из группы',
  destructive: true,
  icon: { ios: 'person.badge.minus', android: 'person_remove', web: 'person_remove' },
};
const CANCEL: MenuAction<MemberAction> = {
  id: 'cancel',
  label: 'Отменить приглашение',
  destructive: true,
  icon: { ios: 'xmark.circle', android: 'cancel', web: 'cancel' },
};

export type MembersTabProps = {
  tab: number;
  participants: ChatParticipant[];
  /** Позванные, но ещё не принявшие — ниже участников. */
  waiting: Person[];
  currentUserId: string | null;
  ownerId: string | null;
  online: Set<string>;
  statuses: Map<string, InfoStatus | null>;
  /** Поиск по участникам: `null` — поиск закрыт, весь список. */
  query: string | null;
  onOpenPerson: (userId: string) => void;
  onRemove: (person: Person) => void;
  onCancelInvite: (person: Person) => void;
};

/**
 * Вкладка «Участники» группы. Тап — профиль человека. Владелец долгим
 * нажатием удаляет участника или отменяет приглашение; у остальных и у
 * своей строки меню нет.
 */
export function MembersTab({
  tab,
  participants,
  waiting,
  currentUserId,
  ownerId,
  online,
  statuses,
  query,
  onOpenPerson,
  onRemove,
  onCancelInvite,
}: MembersTabProps) {
  const [menu, setMenu] = useState<{ row: MemberRow; anchor: MenuAnchor } | null>(null);
  const isOwner = ownerId !== null && ownerId === currentUserId;

  const data = useMemo(() => {
    const rows: MemberRow[] = [
      ...orderMembers(participants, currentUserId, online).map((person) => ({
        person,
        waiting: false,
      })),
      ...waiting.map((person) => ({ person, waiting: true })),
    ];

    return query ? rows.filter((row) => matchesPerson(row.person, query)) : rows;
  }, [currentUserId, online, participants, query, waiting]);

  const select = (action: MemberAction) => {
    if (!menu) return;

    if (action === 'remove') onRemove(menu.row.person);
    else onCancelInvite(menu.row.person);
  };

  return (
    <>
      <InfoTabList
        tab={tab}
        testID="info-members"
        data={data}
        keyExtractor={(row) => row.person.id}
        extraData={{ statuses, menu }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          query ? (
            <View style={styles.empty}>
              <Text color="textSecondary">Никого не нашлось</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <InfoPersonRow
            testID={`info-member-${item.person.id}`}
            name={item.person.displayName}
            avatarUrl={item.person.avatarUrl}
            status={item.waiting ? { text: 'ещё не принял(а)' } : (statuses.get(item.person.id) ?? null)}
            badge={!item.waiting && item.person.id === ownerId ? 'владелец' : undefined}
            onPress={() => onOpenPerson(item.person.id)}
            onLongPress={
              isOwner && item.person.id !== currentUserId
                ? (anchor) => setMenu({ row: item, anchor })
                : undefined
            }
            highlighted={menu?.row.person.id === item.person.id}
          />
        )}
      />
      <AnchoredMenu
        testID="info-member-menu"
        anchor={menu?.anchor ?? null}
        actions={menu?.row.waiting ? [CANCEL] : [REMOVE]}
        onSelect={select}
        onClosed={() => setMenu(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    paddingVertical: Spacing.four,
  },
});
