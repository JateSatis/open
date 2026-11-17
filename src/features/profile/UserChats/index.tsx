import { useRouteParams, ScreenOptions, useRouter } from '@/navigation';
import { ActivityIndicator, FlatList, View } from 'react-native';

import { styles } from './styles';

import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { ChatListItem } from '@/features/chats/ChatListItem';
import { useChatsOf } from '@/features/chats/useChatsOf';
import { useProfile } from '@/features/profile/queries';
import { displayNameOf } from '@/features/profile/username';

/**
 * Диалоги другого человека — так, как этот список видит он сам: его чаты
 * свежими вперёд, название личного диалога — его собеседник, непрочитанное —
 * по его отметке. Тап открывает чат; кто не участник, смотрит его
 * посетителем. Сюда позже добавятся чаты, на которые он подписан.
 */
export function UserChats() {
  const { userId } = useRouteParams<'Dialogs'>();
  const router = useRouter();
  const { data: profile } = useProfile(userId);
  const { chats, isLoading, isLoadingMore, hasMore, error, loadMore } = useChatsOf(userId);
  const title = profile ? `Диалоги: ${displayNameOf(profile)}` : 'Диалоги';

  const open = (chatId: string) => router.push({ name: 'Chat', params: { chatId } });

  return (
    <Screen edges={['bottom']} contentContainerStyle={styles.screen}>
      <ScreenOptions options={{ title }} />

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator accessibilityLabel="Загрузка диалогов" />
        </View>
      ) : chats.length === 0 ? (
        <View style={styles.centered}>
          <Text color={error ? 'danger' : 'textSecondary'} style={styles.emptyText}>
            {error ?? 'Пока ни одного диалога.'}
          </Text>
        </View>
      ) : (
        <FlatList
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          testID="user-chats-list"
          data={chats}
          keyExtractor={(chat) => chat.id}
          // Глазами хозяина списка: собеседник и «непрочитано» — его.
          renderItem={({ item }) => (
            <ChatListItem chat={item} currentUserId={userId} onPress={open} />
          )}
          contentContainerStyle={styles.list}
          onEndReached={hasMore ? loadMore : undefined}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isLoadingMore ? <ActivityIndicator accessibilityLabel="Загрузка диалогов" /> : null
          }
        />
      )}
    </Screen>
  );
}
