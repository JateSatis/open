import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/Text';
import { MediaPickerSheet } from '@/features/chats/MediaPickerSheet';
import { MessageBubble } from '@/features/chats/MessageBubble';
import { MessageComposer } from '@/features/chats/MessageComposer';
import { chatTitle, isChatMember } from '@/features/chats/chatDisplay';
import { useComposerDraft } from '@/features/chats/useComposerDraft';
import { ConnectionTitle } from '@/features/connection/ConnectionTitle';
import { useChat } from '@/features/chats/useChat';
import { useChatMessages, type ChatMessage } from '@/features/chats/useChatMessages';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { useMarkChatRead } from '@/features/chats/useMarkChatRead';
import { useKeyboardVisible } from '@/hooks/use-keyboard-visible';
import { useTheme } from '@/hooks/use-theme';
import { setActiveChatId } from '@/store/activeChat';
import { Spacing } from '@/theme';

export default function ChatScreen() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const isKeyboardVisible = useKeyboardVisible();
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
  const draft = useComposerDraft(chatId);
  const [isMediaSheetOpen, setIsMediaSheetOpen] = useState(false);

  const containerRef = useRef<View | null>(null);
  const [topOffset, setTopOffset] = useState(0);

  const submitDraft = useCallback(() => {
    send(draft.text, draft.media);
    draft.clear();
  }, [draft, send]);

  const measureTopOffset = useCallback(() => {
    containerRef.current?.measureInWindow((_x, y) => setTopOffset(y));
  }, []);

  // Пока чат открыт, уведомления о нём не нужны: человек и так смотрит сюда.
  useEffect(() => {
    setActiveChatId(chatId);

    return () => setActiveChatId(null);
  }, [chatId]);

  useMarkChatRead(chatId, messages.length > 0 ? messages[0].id : null);

  // Диалог прочитан собеседником до этого момента. В групповом чате берём
  // самого отстающего: «прочитано» должно значить «прочитали все».
  const readUpTo = useMemo(() => {
    const others = (chat?.participants ?? []).filter(
      (participant) => participant.id !== currentUserId,
    );

    if (others.length === 0) return null;

    return others.reduce(
      (earliest, participant) =>
        participant.lastReadAt < earliest ? participant.lastReadAt : earliest,
      others[0].lastReadAt,
    );
  }, [chat, currentUserId]);

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
          isRead={readUpTo !== null && item.createdAt <= readUpTo}
          authorName={author?.displayName ?? 'Удалённый аккаунт'}
          authorAvatarUrl={author?.avatarUrl ?? null}
          onRetry={retry}
        />
      );
    },
    [currentUserId, participantsById, readUpTo, retry],
  );

  const typingLabel =
    typingUserIds.length === 1
      ? `${participantsById.get(typingUserIds[0])?.displayName ?? 'Кто-то'} печатает…`
      : typingUserIds.length > 1
        ? 'Несколько человек печатают…'
        : null;

  return (
    <View
      ref={containerRef}
      onLayout={measureTopOffset}
      style={[styles.flex, { backgroundColor: theme.background }]}
    >
      <Stack.Screen
        options={{
          headerTitle: () => (
            <ConnectionTitle title={chat ? chatTitle(chat, currentUserId) : 'Чат'} />
          ),
        }}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        // Клавиатуру приходится обходить вручную на обеих платформах: iOS
        // рисует её поверх экрана, а на Android с edge-to-edge окно под неё
        // больше не сжимается — adjustResize там ничего не даёт.
        behavior="padding"
        // Отступ равен расстоянию от верха окна до этого экрана — то есть
        // высоте шапки со строкой состояния. Он измеряется, а не подбирается:
        // шапка разная на разных устройствах и платформах.
        keyboardVerticalOffset={topOffset}
      >
        {isChatLoading || isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator accessibilityLabel="Загрузка переписки" />
          </View>
        ) : (
          <FlatList
            testID="messages-list"
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

        <View style={{ paddingBottom: isKeyboardVisible ? 0 : insets.bottom }}>
          <MessageComposer
            text={draft.text}
            onChangeText={draft.setText}
            media={draft.media}
            onRemoveMedia={draft.removeMedia}
            canSend={chat ? isChatMember(chat, currentUserId) : false}
            onSend={submitDraft}
            onTyping={notifyTyping}
            onAttachPress={() => setIsMediaSheetOpen(true)}
          />
        </View>
      </KeyboardAvoidingView>

      <MediaPickerSheet
        visible={isMediaSheetOpen}
        onDismiss={() => setIsMediaSheetOpen(false)}
        draft={draft}
        onTyping={notifyTyping}
        onSend={submitDraft}
      />
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
