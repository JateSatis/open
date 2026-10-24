import { useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';

import { styles } from './styles';

import { Input } from '@/components/Input';
import { Text } from '@/components/Text';
import { ChatListItem } from '@/features/chats/ChatListItem';
import { matchesChatQuery } from '@/features/chats/chatDisplay';
import { useChats } from '@/features/chats/useChats';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';

export type ForwardChatPickerProps = {
  /** Отмеченные чаты. Поиск их не сбрасывает: выбор живёт выше списка. */
  selectedIds: ReadonlySet<string>;
  onToggle: (chatId: string) => void;
  /** Первая строка над чатами и над результатами поиска — «Сохранённые». */
  header?: ReactElement;
};

/**
 * Куда переслать: чаты, где я участник, в том же порядке, что на вкладке
 * «Чаты», и поиск по названию и участникам. Тап отмечает чат, повторный —
 * снимает; адресатов может быть несколько. Без «в сети»: канал присутствия
 * уже держит список чатов под этим экраном, второй подписчик на него ломает
 * первого. Чатов, куда я только позван, здесь нет — писать туда я не могу, и
 * список их не отдаёт.
 */
export function ForwardChatPicker({ selectedIds, onToggle, header }: ForwardChatPickerProps) {
  const currentUserId = useCurrentUserId();
  const { chats, isLoading, error } = useChats();
  const [query, setQuery] = useState('');

  // Подписки — каналы и чужие чаты в «Чатах» — тоже не сюда: писать в них
  // я не могу, пересылку база отвергла бы.
  const found = useMemo(
    () =>
      chats.filter((chat) => !chat.subscription && matchesChatQuery(chat, query, currentUserId)),
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
          testID="forward-chat-list"
          style={styles.screen}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          data={found}
          keyExtractor={(chat) => chat.id}
          // Тап по строке при открытой клавиатуре — сразу выбор, а не только
          // закрытие клавиатуры: подпись набирают, пока выбирают.
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListHeaderComponent={header}
          extraData={selectedIds}
          renderItem={({ item }) => (
            <ChatListItem
              chat={item}
              currentUserId={currentUserId}
              onPress={onToggle}
              selected={selectedIds.has(item.id)}
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
