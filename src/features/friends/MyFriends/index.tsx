import { useMemo } from 'react';
import { ActivityIndicator, SectionList, View } from 'react-native';

import { styles } from './styles';

import type { FriendListItem } from '@/api/friends';
import { LinkButton } from '@/components/LinkButton';
import { Text } from '@/components/Text';
import { FriendRow } from '@/features/friends/FriendRow';
import {
  useFriendAction,
  useFriendsList,
  useIncomingFriendRequests,
} from '@/features/friends/queries';
import { describeLoadError } from '@/lib/network';

type Section = { key: 'requests' | 'friends'; title: string; data: FriendListItem[] };

export type MyFriendsProps = {
  userId: string;
  onOpenPerson: (userId: string) => void;
};

/**
 * Свои друзья: сверху входящие заявки (принять или отклонить — отказ
 * отправителю не виден), ниже сами друзья. Оба списка постраничные: сначала
 * дочитываются заявки, потом друзья.
 */
export function MyFriends({ userId, onOpenPerson }: MyFriendsProps) {
  const requests = useIncomingFriendRequests();
  const friends = useFriendsList(userId);
  const action = useFriendAction();

  const sections = useMemo((): Section[] => {
    const incoming = (requests.data ?? []).flatMap((page) => page.items);
    const mine = (friends.data ?? []).flatMap((page) => page.items);

    return [
      ...(incoming.length > 0 ? [{ key: 'requests' as const, title: 'Заявки', data: incoming }] : []),
      { key: 'friends', title: 'Друзья', data: mine },
    ];
  }, [friends.data, requests.data]);

  if (requests.isPending || friends.isPending) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator accessibilityLabel="Загрузка друзей" />
      </View>
    );
  }

  const loadError = describeLoadError(
    requests.error ?? friends.error,
    'Не удалось загрузить друзей',
  );
  const actionError = action.error
    ? 'Не получилось. Проверьте интернет и попробуйте ещё раз.'
    : null;
  const problem = actionError ?? loadError;

  const loadMore = () => {
    if (requests.hasNextPage) void requests.fetchNextPage();
    else if (friends.hasNextPage) void friends.fetchNextPage();
  };

  const busy = (personId: string, kind: 'accept' | 'decline') =>
    action.isPending &&
    action.variables?.userId === personId &&
    action.variables.action === kind;

  return (
    <SectionList
      testID="my-friends"
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      sections={sections}
      keyExtractor={(item, index) => `${item.id}-${index}`}
      stickySectionHeadersEnabled={false}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        problem ? (
          <Text variant="small" color="danger" style={styles.problem}>
            {problem}
          </Text>
        ) : null
      }
      renderSectionHeader={({ section }) => (
        <Text variant="smallBold" color="textSecondary" style={styles.sectionTitle}>
          {section.title}
        </Text>
      )}
      renderSectionFooter={({ section }) =>
        section.key === 'friends' && section.data.length === 0 ? (
          <Text color="textSecondary" style={styles.empty}>
            Пока ни одного друга. Добавить в друзья можно из профиля человека.
          </Text>
        ) : null
      }
      renderItem={({ item, section }) => (
        <FriendRow
          person={item}
          onPress={onOpenPerson}
          actions={
            section.key === 'requests' ? (
              <>
                <LinkButton
                  label="Отклонить"
                  color="textSecondary"
                  accessibilityLabel={`Отклонить заявку: ${item.displayName ?? ''}`}
                  loading={busy(item.id, 'decline')}
                  onPress={() => action.mutate({ action: 'decline', userId: item.id })}
                />
                <LinkButton
                  label="Принять"
                  accessibilityLabel={`Принять заявку: ${item.displayName ?? ''}`}
                  loading={busy(item.id, 'accept')}
                  onPress={() => action.mutate({ action: 'accept', userId: item.id })}
                />
              </>
            ) : null
          }
        />
      )}
      ListFooterComponent={
        requests.isFetchingNextPage || friends.isFetchingNextPage ? (
          <ActivityIndicator accessibilityLabel="Загрузка друзей" />
        ) : null
      }
    />
  );
}
