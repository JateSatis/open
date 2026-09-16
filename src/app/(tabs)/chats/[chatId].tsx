import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/Text';
import { MessageBubble } from '@/features/chats/MessageBubble';
import { MessageComposer } from '@/features/chats/MessageComposer';
import { chatTitle, isChatMember } from '@/features/chats/chatDisplay';
import { useChat } from '@/features/chats/useChat';
import { useChatMessages, type ChatMessage } from '@/features/chats/useChatMessages';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export default function ChatScreen() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const currentUserId = useCurrentUserId();
  const { chat, isLoading: isChatLoading, error: chatError } = useChat(chatId);
  const {
    messages,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    typingUserIds,
    loadMore,
    send,
    retry,
    notifyTyping,
  } = useChatMessages(chatId, currentUserId);

  const participantsById = useMemo(
    () => new Map((chat?.participants ?? []).map((participant) => [participant.id, participant])),
    [chat],
  );

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => {
      const author = item.authorId ? participantsById.get(item.authorId) : undefined;

      return (
        <MessageBubble
          message={item}
          isOwn={item.authorId === currentUserId}
          authorName={author?.displayName ?? 'Удалённый аккаунт'}
          authorAvatarUrl={author?.avatarUrl ?? null}
          onRetry={retry}
        />
      );
    },
    [currentUserId, participantsById, retry],
  );

  const typingLabel =
    typingUserIds.length === 1
      ? `${participantsById.get(typingUserIds[0])?.displayName ?? 'Кто-то'} печатает…`
      : typingUserIds.length > 1
        ? 'Несколько человек печатают…'
        : null;

  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: chat ? chatTitle(chat, currentUserId) : 'Чат' }} />

      <KeyboardAvoidingView
        style={styles.flex}
        // iOS floats the keyboard over the screen, so the composer has to be
        // lifted by hand; on Android `adjustResize` already shrinks the window
        // and adding padding on top of it double-counts the keyboard.
        behavior={Platform.select({ ios: 'padding', default: undefined })}
        keyboardVerticalOffset={Platform.select({ ios: insets.top + Spacing.six, default: 0 })}
      >
        {isChatLoading || isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator accessibilityLabel="Загрузка переписки" />
          </View>
        ) : (
          <FlatList
            inverted
            data={messages}
            keyExtractor={(message) => message.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            // The list is inverted, so its "end" is the top of the screen:
            // scrolling up pages further back through the history.
            onEndReached={hasMore ? loadMore : undefined}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
              isLoadingMore ? <ActivityIndicator accessibilityLabel="Загрузка истории" /> : null
            }
          />
        )}

        {!isChatLoading && !isLoading && messages.length === 0 ? (
          <View style={styles.centered}>
            <Text color="textSecondary">
              Сообщений пока нет. Всё, что здесь появится, сможет прочитать кто угодно.
            </Text>
          </View>
        ) : null}

        {chatError || error ? (
          <View style={styles.banner}>
            <Text variant="small" color="danger">
              {chatError ?? error}
            </Text>
          </View>
        ) : null}

        {typingLabel ? (
          <View style={styles.banner}>
            <Text variant="small" color="textSecondary">
              {typingLabel}
            </Text>
          </View>
        ) : null}

        <View style={{ paddingBottom: insets.bottom }}>
          <MessageComposer
            canSend={chat ? isChatMember(chat, currentUserId) : false}
            onSend={send}
            onTyping={notifyTyping}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flexGrow: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  banner: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.one,
  },
});
