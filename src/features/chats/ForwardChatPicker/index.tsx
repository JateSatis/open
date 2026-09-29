import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';

import { styles } from './styles';

import { Input } from '@/components/Input';
import { Text } from '@/components/Text';
import { ChatListItem } from '@/features/chats/ChatListItem';
import { counterpart, matchesChatQuery } from '@/features/chats/chatDisplay';
import { useChats } from '@/features/chats/useChats';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { useOnlineUsers } from '@/features/chats/useOnlineUsers';

export type ForwardChatPickerProps = {
  onPick: (chatId: string) => void;
};

/**
 * Куда переслать: чаты, где я участник, в том же порядке, что на вкладке
 * «Чаты», и поиск по названию и участникам. Чатов, куда я только позван,
 * здесь нет — писать туда я не могу, и список их не отдаёт.
 */
export function ForwardChatPicker({ onPick }: ForwardChatPickerProps) {
  const currentUserId = useCurrentUserId();
  const onlineIds = useOnlineUsers(currentUserId);
  const { chats, isLoading, error } = useChats();
  const [query, setQuery] = useState('');

  const found = useMemo(
    () => chats.filter((chat) => matchesChatQuery(chat, query, currentUserId)),
    [chats, currentUserId, query],
  );

  return (
    <View style={styles.screen}>
      <View style={styles.search}>
        <Input
          accessibilityLabel="Поиск чата"
          placeholder="Поиск"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {error ? (
        <Text color="danger" style={styles.message}>
          {error}
        </Text>
      ) : null}

      {isLoading ? (
        <ActivityIndicator accessibilityLabel="Загрузка чатов" />
      ) : (
        <FlatList
          data={found}
          keyExtractor={(chat) => chat.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <ChatListItem
              chat={item}
              currentUserId={currentUserId}
              isOnline={onlineIds.has(counterpart(item, currentUserId)?.id ?? '')}
              onPress={onPick}
            />
          )}
          ListEmptyComponent={
            <Text color="textSecondary" style={styles.message}>
              {query.trim() ? 'Ничего не нашлось' : 'Пока некуда пересылать: у вас нет чатов'}
            </Text>
          }
        />
      )}
    </View>
  );
}
