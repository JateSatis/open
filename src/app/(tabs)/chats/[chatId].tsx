import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Keyboard,
  StyleSheet,
  useWindowDimensions,
  View,
  type TextInput,
} from 'react-native';
import Animated from 'react-native-reanimated';

import { Text } from '@/components/Text';
import { ChatFooter, modePlate } from '@/features/chats/ChatFooter';
import { ChatScreenHeader } from '@/features/chats/ChatScreenHeader';
import { MediaPickerSheet } from '@/features/chats/MediaPickerSheet';
import { MessageBubble } from '@/features/chats/MessageBubble';
import { MessageContextMenu } from '@/features/chats/MessageContextMenu';
import { MessageRow } from '@/features/chats/MessageRow';
import { PinnedBar } from '@/features/chats/PinnedBar';
import {
  canReactTo,
  isLocalMessage,
  visibleMessageActions,
} from '@/features/chats/messageActions';
import { DELETED_ACCOUNT } from '@/features/chats/messageQuote';
import {
  activityLabel,
  chatTitle,
  counterpart,
  isChatMember,
  readUpTo as readUpToOf,
} from '@/features/chats/chatDisplay';
import { mosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { useChatKeyboardInset } from '@/features/chats/useChatKeyboardInset';
import { useComposerDraft } from '@/features/chats/useComposerDraft';
import { useChat } from '@/features/chats/useChat';
import { useChatMessages, type ChatMessage } from '@/features/chats/useChatMessages';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { useJumpToMessage } from '@/features/chats/useJumpToMessage';
import { useMarkChatRead } from '@/features/chats/useMarkChatRead';
import { readChatDraft } from '@/features/chats/composerDraftStore';
import { useMessageActionHandlers } from '@/features/chats/useMessageActionHandlers';
import { useMessageEdit } from '@/features/chats/useMessageEdit';
import { useMessageMenu } from '@/features/chats/useMessageMenu';
import { useMessageSelection } from '@/features/chats/useMessageSelection';
import { useMyInvite } from '@/features/chats/useMyInvite';
import { usePinnedCursor } from '@/features/chats/usePinnedCursor';
import { usePinnedMessages } from '@/features/chats/usePinnedMessages';
import { useQuoteNavigation } from '@/features/chats/useQuoteNavigation';
import { useReplyForward } from '@/features/chats/useReplyForward';
import { useRespondToInvite } from '@/features/chats/useRespondToInvite';
import { WaitingBanner } from '@/features/chats/WaitingBanner';
import { CommentsPanel, commentsEntry } from '@/features/interactions/CommentsPanel';
import { useReactToMessage } from '@/features/interactions/useReactToMessage';
import { stopVoice } from '@/features/media';
import { showNotice } from '@/features/notifications/alertsStore';
import { useProfile } from '@/features/profile/queries';
import { useTheme } from '@/hooks/use-theme';
import { setActiveChatId } from '@/store/activeChat';
import { Spacing } from '@/theme';

const noop = () => undefined;

/** Ближе этого к самому новому сообщению список держится за низ переписки, а не за прочитанное. */
const KEEP_READING_POSITION = { minIndexForVisible: 0, autoscrollToTopThreshold: Spacing.six };

/** Облачко чужого сообщения начинается после аватара и зазора (`MessageBubble`). */
const BUBBLE_LEADING_INSET = Spacing.five + Spacing.two;

export default function ChatScreen() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const router = useRouter();
  const nav = useNavigation();
  const theme = useTheme();
  const {
    containerRef,
    onLayout: measureBottomOffset,
    style: keyboardInsetStyle,
    top: contentTop,
  } = useChatKeyboardInset();
  const { width: windowWidth } = useWindowDimensions();
  // Ширина списка — окно минус его боковые поля (`styles.list`).
  const mediaBounds = useMemo(() => mosaicBounds(windowWidth - Spacing.three * 2), [windowWidth]);
  const currentUserId = useCurrentUserId();
  const { chat, isLoading: isChatLoading, error: chatError } = useChat(chatId);
  const chatMessages = useChatMessages(chatId, currentUserId);
  const { messages, isLoading, isLoadingMore, hasMore, error, activities } = chatMessages;
  const { loadMore, retry, notifyTyping, notifyRecordingVoice } = chatMessages;
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const composerRef = useRef<TextInput>(null);
  const pins = usePinnedMessages(chatId);
  const pinCursor = usePinnedCursor(pins.pins);
  const selection = useMessageSelection(messages);
  const jump = useJumpToMessage(listRef, messages, chatMessages.loadUntil);
  const menu = useMessageMenu();
  const draft = useComposerDraft(chatId);
  const isMember = chat ? isChatMember(chat, currentUserId) : false;
  // Заявку спрашиваем только у не-участника: участнику отвечать уже не на что.
  const myInvite = useMyInvite(chatId, chat !== null && !isMember);
  const invite = useRespondToInvite();
  const waitingForOthers = useMemo(
    () => (chat?.waiting ?? []).filter((person) => person.id !== currentUserId),
    [chat, currentUserId],
  );
  const navigation = useQuoteNavigation(chatId, jump.jump, !isLoading && !isChatLoading);
  const reactions = useReactToMessage(chatId, isMember);

  // Пока чат открыт, уведомления о нём не нужны: человек и так смотрит сюда.
  useEffect(() => {
    setActiveChatId(chatId);

    return () => setActiveChatId(null);
  }, [chatId]);

  // Плеер голосовых общий на приложение и переживает облачко, уехавшее за
  // экран. Но не чат: закрыл переписку — голосовое замолкает.
  useEffect(() => () => stopVoice(), [chatId]);

  useMarkChatRead(chatId, messages.length > 0 ? messages[0].id : null);

  const readUpTo = useMemo(() => readUpToOf(chat, currentUserId), [chat, currentUserId]);

  // Собеседник личного диалога: его статус — в шапке, тап по шапке — его профиль.
  const other = chat ? counterpart(chat, currentUserId) : null;
  const { data: otherProfile } = useProfile(other?.id);

  const openPerson = useCallback(
    (personId: string) => {
      if (personId === currentUserId) {
        router.navigate('/profile');
        return;
      }

      router.push(`/chats/people/${personId}`);
    },
    [currentUserId, router],
  );

  const participantsById = useMemo(
    () => new Map((chat?.participants ?? []).map((participant) => [participant.id, participant])),
    [chat],
  );

  const authorName = useCallback(
    (authorId: string | null) =>
      (authorId ? participantsById.get(authorId)?.displayName : undefined) ?? DELETED_ACCOUNT,
    [participantsById],
  );

  const replyForward = useReplyForward({
    chatId,
    draft,
    authorName,
    composerRef,
    send: chatMessages.send,
    sendVoice: chatMessages.sendVoice,
    forward: chatMessages.forward,
  });
  const edit = useMessageEdit({ chatId, draft, composerRef, saveEdit: chatMessages.saveEdit });
  const { leave: leaveEdit, start: beginEdit } = edit;
  const editingId = edit.mode?.message.id ?? null;
  const isEditing = editingId !== null;

  // Плашка над полем одна: ответ посреди правки сначала закрывает правку
  // (с вопросом, если в ней что-то изменено).
  const afterEdit = useCallback(
    (next: () => void) => {
      // Без идущей правки — сразу, в этом же кадре: меню закрывается, и поле
      // успевает получить фокус.
      if (readChatDraft(chatId).mode?.type !== 'edit') {
        next();
        return;
      }

      void leaveEdit().then((left) => {
        if (left) next();
      });
    },
    [chatId, leaveEdit],
  );

  const { startReply: beginReply } = replyForward;
  const startReply = useCallback(
    (targets: ChatMessage[]) => afterEdit(() => beginReply(targets)),
    [afterEdit, beginReply],
  );

  const startEdit = useCallback(
    (message: ChatMessage) => afterEdit(() => beginEdit(message)),
    [afterEdit, beginEdit],
  );

  const { runMessageAction, runSelectionAction } = useMessageActionHandlers({
    selection,
    pins,
    retry,
    discard: chatMessages.discard,
    deleteMessages: chatMessages.deleteMessages,
    authorName,
    reply: startReply,
    forward: replyForward.startForward,
    edit: startEdit,
  });

  // Системный «назад» в правке выходит из правки, а не из чата.
  // На время выбора «назад» принадлежит выбору.
  const selectionActive = selection.isActive;

  useEffect(() => {
    if (!isEditing || selectionActive) return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      void leaveEdit();
      return true;
    });

    return () => subscription.remove();
  }, [isEditing, leaveEdit, selectionActive]);

  // Уход из чата посреди правки — тем же выходом: с вопросом, если что-то изменено.
  useEffect(
    () =>
      nav.addListener('beforeRemove', (event) => {
        if (readChatDraft(chatId).mode?.type !== 'edit') return;

        event.preventDefault();
        void leaveEdit().then((left) => {
          if (left) nav.dispatch(event.data.action);
        });
      }),
    [chatId, leaveEdit, nav],
  );

  // Системный «назад» в режиме выбора выходит из выбора, а не из чата.
  const { isActive: isSelecting, clear: clearSelection } = selection;

  useEffect(() => {
    if (!isSelecting) return;

    Keyboard.dismiss();

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      clearSelection();
      return true;
    });

    return () => subscription.remove();
  }, [clearSelection, isSelecting]);

  const { openQuote, openForwardOrigin } = navigation;
  const { audience: reactionAudience, toggle: toggleReaction } = reactions;

  const bubbleFor = useCallback(
    (item: ChatMessage, interactive: boolean) => {
      const { authorId } = item;
      const author = authorId ? participantsById.get(authorId) : undefined;

      return (
        <MessageBubble
          message={item}
          isOwn={item.authorId === currentUserId}
          isRead={readUpTo !== null && item.createdAt <= readUpTo}
          authorName={author?.displayName ?? DELETED_ACCOUNT}
          authorAvatarUrl={author?.avatarUrl ?? null}
          mediaBounds={mediaBounds}
          onRetry={retry}
          onAuthorPress={interactive && authorId ? () => openPerson(authorId) : undefined}
          onQuotePress={interactive ? () => openQuote(item) : undefined}
          onForwardPress={interactive ? () => openForwardOrigin(item) : undefined}
          reactionAudience={reactionAudience}
          onReactionToggle={
            interactive && canReactTo(item) ? (emoji) => toggleReaction(item, emoji) : undefined
          }
          comments={commentsEntry(item, chatId, interactive)}
        />
      );
    },
    [
      chatId,
      currentUserId,
      mediaBounds,
      openForwardOrigin,
      openPerson,
      openQuote,
      participantsById,
      reactionAudience,
      readUpTo,
      retry,
      toggleReaction,
    ],
  );

  const { isSelected, toggle: toggleSelected } = selection;
  const { highlight } = jump;
  const { open: openMenu } = menu;

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <MessageRow
        selectionMode={isSelecting}
        selectable={!isLocalMessage(item)}
        selected={isSelected(item.id)}
        editing={item.id === editingId}
        highlightKey={highlight?.messageId === item.id ? highlight.key : null}
        messageId={item.id}
        onLongPress={(anchor) => openMenu(item, anchor)}
        onToggle={() => toggleSelected(item.id)}
        // Ответ — это отправка: свайп есть только у участника и только у
        // сообщений, которые уже на сервере.
        onSwipeReply={isMember && !isLocalMessage(item) ? () => startReply([item]) : undefined}
      >
        {bubbleFor(item, true)}
      </MessageRow>
    ),
    [
      bubbleFor,
      editingId,
      highlight,
      isMember,
      isSelected,
      isSelecting,
      openMenu,
      startReply,
      toggleSelected,
    ],
  );

  const menuMessage = menu.target?.message ?? null;
  const menuActions = useMemo(
    () =>
      menuMessage
        ? visibleMessageActions({
            message: menuMessage,
            isOwn: menuMessage.authorId === currentUserId,
            isMember,
            isPinned: pins.isPinned(menuMessage.id),
          })
        : [],
    [currentUserId, isMember, menuMessage, pins],
  );

  // Реакция из меню — на сообщение, каким оно стало к моменту тапа: пока меню
  // было открыто, моя прежняя реакция могла доехать или откатиться.
  const menuReactions = useMemo(() => {
    if (!menuMessage || !canReactTo(menuMessage)) return null;

    return {
      selected: menuMessage.reactions.mine?.emoji ?? null,
      onSelect: (emoji: string) =>
        toggleReaction(
          messages.find((message) => message.id === menuMessage.id) ?? menuMessage,
          emoji,
        ),
    };
  }, [menuMessage, messages, toggleReaction]);

  const { jump: jumpTo } = jump;
  const { advance: advancePin } = pinCursor;

  const openPinned = useCallback(
    (pin: { messageId: string; messageCreatedAt: string }) => {
      advancePin();
      void jumpTo(pin.messageId, pin.messageCreatedAt).then((found) => {
        if (!found) showNotice('Не удалось найти сообщение', 'error');
      });
    },
    [advancePin, jumpTo],
  );

  const typingLabel = activityLabel(
    activities,
    (userId) => participantsById.get(userId)?.displayName ?? 'Кто-то',
  );

  const { setMode } = draft;
  const closeMode = useCallback(() => {
    if (isEditing) {
      void leaveEdit();
      return;
    }

    setMode(null);
  }, [isEditing, leaveEdit, setMode]);

  const editPlate = edit.composer
    ? {
        onRemoveAttachment: edit.removeAttachment,
        onRemoveVoice: edit.removeVoice,
        state: edit.composer,
      }
    : undefined;
  const submit = isEditing ? edit.save : replyForward.submit;

  return (
    <View
      ref={containerRef}
      onLayout={measureBottomOffset}
      style={[styles.flex, { backgroundColor: theme.background }]}
    >
      <ChatScreenHeader
        title={chat ? chatTitle(chat, currentUserId) : 'Чат'}
        subtitle={otherProfile?.status}
        onTitlePress={other ? () => openPerson(other.id) : undefined}
        selectedCount={selection.selected.length}
        onCancelSelection={clearSelection}
      />

      <Animated.View testID="chat-keyboard-area" style={[styles.flex, keyboardInsetStyle]}>
        <PinnedBar pins={pins.pins} index={pinCursor.index} onPress={openPinned} />

        <WaitingBanner waiting={waitingForOthers} />

        {isChatLoading || isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator accessibilityLabel="Загрузка переписки" />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            testID="messages-list"
            inverted
            data={messages}
            onScrollToIndexFailed={jump.onScrollToIndexFailed}
            keyExtractor={(message) => message.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            // The list is inverted, so its "end" is the top of the screen:
            // scrolling up pages further back through the history.
            // Облачко ниже экрана выросло или сжалось (правка, подгрузка
            // картинки) — то, что человек читает выше, остаётся на месте.
            // У самого низа переписки список по-прежнему едет за новым.
            maintainVisibleContentPosition={KEEP_READING_POSITION}
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

        <ChatFooter
          selection={{
            isActive: isSelecting,
            context: { selected: selection.selected, currentUserId, isMember },
            onAction: runSelectionAction,
          }}
          invite={
            !isMember && myInvite && myInvite.status !== 'accepted'
              ? {
                  value: myInvite,
                  responding: invite.pending?.chatId === chatId ? invite.pending.answer : null,
                  error: invite.error,
                  onAccept: () => invite.respond(chatId, 'accept'),
                  onDecline: () => invite.respond(chatId, 'decline'),
                }
              : null
          }
          composer={{
            text: draft.text,
            onChangeText: draft.setText,
            mode: draft.mode,
            onCloseMode: closeMode,
            edit: editPlate,
            canSend: isMember,
            onSend: submit,
            onTyping: notifyTyping,
            onSendVoice: isEditing ? edit.recorded : replyForward.sendVoice,
            // Запись в правке не уходит в чат — и «записывает голосовое…» не правда.
            onRecordingVoice: isEditing ? noop : notifyRecordingVoice,
            inputRef: composerRef,
          }}
        />
      </Animated.View>

      <MediaPickerSheet
        draft={draft}
        plate={
          draft.mode?.type === 'reply' || draft.mode?.type === 'edit'
            ? modePlate(draft.mode, closeMode, editPlate)
            : null
        }
        editing={isEditing}
        onTyping={notifyTyping}
        onSend={submit}
      />

      <MessageContextMenu
        anchor={menu.target?.anchor ?? null}
        preview={menuMessage ? bubbleFor(menuMessage, false) : null}
        actions={menuActions}
        reactions={menuReactions}
        alignEnd={menuMessage?.authorId === currentUserId}
        leadingInset={BUBBLE_LEADING_INSET}
        onAction={(id) => menuMessage && runMessageAction(id, menuMessage)}
        onClose={menu.close}
      />

      <CommentsPanel topInset={contentTop} onOpenPerson={openPerson} />
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
