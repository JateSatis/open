import { useRouter, useRouteParams } from '@/navigation';
import { ActivityIndicator, FlatList, View } from 'react-native';

import { styles } from './styles';

import { FriendsListHiddenError } from '@/api/friends';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { FriendRow } from '@/features/friends/FriendRow';
import { useFriendsList } from '@/features/friends/queries';
import { describeLoadError } from '@/lib/network';

export type FriendsListProps = {
  userId: string;
  onOpenPerson: (userId: string) => void;
};

/**
 * Друзья другого человека — постранично. Закрыл список настройкой — сервер
 * отказывает, и экран так и говорит, без пустого списка вместо отказа.
 */
export function FriendsList() {
  const router = useRouter();
  const { userId } = useRouteParams<'Friends'>();
  const onOpenPerson = (userId: string) => router.push({ name: 'Person', params: { userId } });
  return (
    <Screen edges={['bottom']}>
      <FriendsListContent userId={userId} onOpenPerson={onOpenPerson} />
    </Screen>
  );
}

function FriendsListContent({ userId, onOpenPerson }: FriendsListProps) {
  const { data, isPending, error, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useFriendsList(userId);
  const friends = (data ?? []).flatMap((page) => page.items);

  if (isPending) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator accessibilityLabel="Загрузка друзей" />
      </View>
    );
  }

  if (error instanceof FriendsListHiddenError) {
    return (
      <View style={styles.centered}>
        <Text color="textSecondary" style={styles.message}>
          Список друзей скрыт.
        </Text>
      </View>
    );
  }

  const problem = describeLoadError(error, 'Не удалось загрузить друзей');

  return (
    <FlatList
      testID="friends-list"
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      data={friends}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <FriendRow person={item} onPress={onOpenPerson} />}
      onEndReached={hasNextPage ? () => void fetchNextPage() : undefined}
      onEndReachedThreshold={0.5}
      contentContainerStyle={styles.list}
      ListEmptyComponent={
        <Text color={problem ? 'danger' : 'textSecondary'} style={styles.message}>
          {problem ?? 'Пока ни одного друга.'}
        </Text>
      }
      ListFooterComponent={
        isFetchingNextPage ? <ActivityIndicator accessibilityLabel="Загрузка друзей" /> : null
      }
    />
  );
}
