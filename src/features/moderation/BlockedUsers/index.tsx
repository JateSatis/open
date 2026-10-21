import { useMemo } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';

import { styles } from './styles';

import { LinkButton } from '@/components/LinkButton';
import { Text } from '@/components/Text';
import { FriendRow } from '@/features/friends/FriendRow';
import { useBlockedUsers, useSetBlocked } from '@/features/moderation/queries';
import { displayNameOf } from '@/features/profile/username';
import { describeLoadError } from '@/lib/network';

export type BlockedUsersProps = {
  onOpenPerson: (userId: string) => void;
};

/**
 * «Заблокированные»: кого я заблокировал, свежие сверху, страницами.
 * Разблокировка не возвращает дружбу и заявки — их рвала сама блокировка.
 */
export function BlockedUsers({ onOpenPerson }: BlockedUsersProps) {
  const blocked = useBlockedUsers();
  const setBlocked = useSetBlocked();
  const people = useMemo(() => (blocked.data ?? []).flatMap((page) => page.items), [blocked.data]);

  if (blocked.isPending) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator accessibilityLabel="Загрузка заблокированных" />
      </View>
    );
  }

  const problem = setBlocked.error
    ? 'Не получилось. Проверьте интернет и попробуйте ещё раз.'
    : describeLoadError(blocked.error, 'Не удалось загрузить список');

  return (
    <FlatList
      testID="blocked-users"
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      data={people}
      keyExtractor={(person) => person.id}
      onEndReached={() => {
        if (blocked.hasNextPage) void blocked.fetchNextPage();
      }}
      onEndReachedThreshold={0.5}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        problem ? (
          <Text variant="small" color="danger" style={styles.problem}>
            {problem}
          </Text>
        ) : null
      }
      ListEmptyComponent={
        problem ? null : (
          <Text color="textSecondary" style={styles.empty}>
            Вы никого не заблокировали. Заблокировать человека можно в его профиле или в заявке на
            диалог.
          </Text>
        )
      }
      renderItem={({ item }) => (
        <FriendRow
          person={item}
          onPress={onOpenPerson}
          actions={
            <LinkButton
              label="Разблокировать"
              accessibilityLabel={`Разблокировать: ${displayNameOf(item)}`}
              loading={setBlocked.isPending && setBlocked.variables?.userId === item.id}
              onPress={() => setBlocked.mutate({ userId: item.id, blocked: false })}
            />
          }
        />
      )}
    />
  );
}
