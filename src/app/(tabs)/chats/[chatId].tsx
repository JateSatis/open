import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { impactAsync, ImpactFeedbackStyle } from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useWindowDimensions as useKeyboardWindow } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/Text';
import { ChatHeaderTitle } from '@/features/chats/ChatHeaderTitle';
import {
  armMediaSheet,
  MediaPickerSheet,
  openMediaSheet,
  releaseMediaSheetArm,
} from '@/features/chats/MediaPickerSheet';
import { InviteResponseBar } from '@/features/chats/InviteResponseBar';
import { MessageBubble } from '@/features/chats/MessageBubble';
import { MessageComposer } from '@/features/chats/MessageComposer';
import { MessageContextMenu, type AnchorRect } from '@/features/chats/MessageContextMenu';
import { MessageRow } from '@/features/chats/MessageRow';
import { setLiftedMessage } from '@/features/chats/MessageRow/liftedStore';
import { PinnedBar } from '@/features/chats/PinnedBar';
import { SelectionActionBar } from '@/features/chats/SelectionActionBar';
import { isLocalMessage, visibleMessageActions } from '@/features/chats/messageActions';
import { activityLabel, chatTitle, counterpart, isChatMember } from '@/features/chats/chatDisplay';
import { claimKeyboardForChat, useOwnKeyboardHeight } from '@/features/chats/composerKeyboard';
import { mosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { useComposerDraft } from '@/features/chats/useComposerDraft';
import { useChat } from '@/features/chats/useChat';
import { useChatMessages, type ChatMessage } from '@/features/chats/useChatMessages';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { useJumpToMessage } from '@/features/chats/useJumpToMessage';
import { useMarkChatRead } from '@/features/chats/useMarkChatRead';
import { useMessageActionHandlers } from '@/features/chats/useMessageActionHandlers';
import { useMessageSelection } from '@/features/chats/useMessageSelection';
import { useMyInvite } from '@/features/chats/useMyInvite';
import { usePinnedCursor } from '@/features/chats/usePinnedCursor';
import { usePinnedMessages } from '@/features/chats/usePinnedMessages';
import { useRespondToInvite } from '@/features/chats/useRespondToInvite';
import { WaitingBanner } from '@/features/chats/WaitingBanner';
import { stopVoice } from '@/features/media';
import { showNotice } from '@/features/notifications/alertsStore';
import { useProfile } from '@/features/profile/queries';
import { useTheme } from '@/hooks/use-theme';
import { setActiveChatId } from '@/store/activeChat';
import { Spacing } from '@/theme';

/** Облачко чужого сообщения начинается после аватара и зазора (`MessageBubble`). */
const BUBBLE_LEADING_INSET = Spacing.five + Spacing.two;

type MenuTarget = { message: ChatMessage; anchor: AnchorRect };

export default function ChatScreen() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useOwnKeyboardHeight('chat');
  // Размер окна целиком, от края до края, — от него же меряется клавиатура.
  const { height: windowHeight } = useKeyboardWindow();
  const containerRef = useRef<View | null>(null);
  const [bottomOffset, setBottomOffset] = useState(0);
  const { width: windowWidth } = useWindowDimensions();
  // Ширина списка — окно минус его боковые поля (`styles.list`).
  const mediaBounds = useMemo(() => mosaicBounds(windowWidth - Spacing.three * 2), [windowWidth]);
  const currentUserId = useCurrentUserId();
  const { chat, isLoading: isChatLoading, error: chatError } = useChat(chatId);
  const {
    messages,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    activities,
    loadMore,
    loadUntil,
    send,
    sendVoice,
    retry,
    discard,
    deleteMessages,
    notifyTyping,
    notifyRecordingVoice,
  } = useChatMessages(chatId, currentUserId);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const pins = usePinnedMessages(chatId);
  const pinCursor = usePinnedCursor(pins.pins);
  const selection = useMessageSelection(messages);
  const jump = useJumpToMessage(listRef, messages, loadUntil);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const draft = useComposerDraft(chatId);
  const isMember = chat ? isChatMember(chat, currentUserId) : false;
  // Заявку спрашиваем только у не-участника: участнику отвечать уже не на что.
  const myInvite = useMyInvite(chatId, chat !== null && !isMember);
  const invite = useRespondToInvite();
  const waitingForOthers = useMemo(
    () => (chat?.waiting ?? []).filter((person) => person.id !== currentUserId),
    [chat, currentUserId],
  );

  const submitDraft = useCallback(() => {
    send(draft.text, draft.media());
    draft.clear();
  }, [draft, send]);

  // Пока чат открыт, уведомления о нём не нужны: человек и так смотрит сюда.
  useEffect(() => {
    setActiveChatId(chatId);

    return () => setActiveChatId(null);
  }, [chatId]);

  // Плеер голосовых общий на приложение и переживает облачко, уехавшее за
  // экран. Но не чат: закрыл переписку — голосовое замолкает.
  useEffect(() => () => stopVoice(), [chatId]);

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
      (authorId ? participantsById.get(authorId)?.displayName : undefined) ?? 'Удалённый аккаунт',
    [participantsById],
  );

  const { runMessageAction, runSelectionAction } = useMessageActionHandlers({
    selection,
    pins,
    retry,
    discard,
    deleteMessages,
    authorName,
  });

  const openMenu = useCallback((message: ChatMessage, anchor: AnchorRect) => {
    impactAsync(ImpactFeedbackStyle.Medium).catch(() => undefined);
    Keyboard.dismiss();
    setLiftedMessage(message.id);
    setMenu({ message, anchor });
  }, []);

  const closeMenu = useCallback(() => {
    setLiftedMessage(null);
    setMenu(null);
  }, []);

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

  const bubbleFor = useCallback(
    (item: ChatMessage, interactive: boolean) => {
      const { authorId } = item;
      const author = authorId ? participantsById.get(authorId) : undefined;

      return (
        <MessageBubble
          message={item}
          isOwn={item.authorId === currentUserId}
          isRead={readUpTo !== null && item.createdAt <= readUpTo}
          authorName={author?.displayName ?? 'Удалённый аккаунт'}
          authorAvatarUrl={author?.avatarUrl ?? null}
          mediaBounds={mediaBounds}
          onRetry={retry}
          onAuthorPress={interactive && authorId ? () => openPerson(authorId) : undefined}
        />
      );
    },
    [currentUserId, mediaBounds, openPerson, participantsById, readUpTo, retry],
  );

  const { isSelected, toggle: toggleSelected } = selection;
  const { highlight } = jump;

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <MessageRow
        selectionMode={isSelecting}
        selectable={!isLocalMessage(item)}
        selected={isSelected(item.id)}
        highlightKey={highlight?.messageId === item.id ? highlight.key : null}
        messageId={item.id}
        onLongPress={(anchor) => openMenu(item, anchor)}
        onToggle={() => toggleSelected(item.id)}
      >
        {bubbleFor(item, true)}
      </MessageRow>
    ),
    [bubbleFor, highlight, isSelected, isSelecting, openMenu, toggleSelected],
  );

  const menuActions = useMemo(
    () =>
      menu
        ? visibleMessageActions({
            message: menu.message,
            isOwn: menu.message.authorId === currentUserId,
            isMember,
            isPinned: pins.isPinned(menu.message.id),
          })
        : [],
    [currentUserId, isMember, menu, pins],
  );

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

  /**
   * Что лежит под экраном чата до низа окна — таб-бар. Его клавиатура
   * перекрывает, и на его высоту поле подниматься не должно. Измеряется, а не
   * подбирается: таб-бар разный на разных устройствах и платформах.
   */
  const measureBottomOffset = useCallback(() => {
    containerRef.current?.measureInWindow((_x, y, _width, height) =>
      setBottomOffset(Math.max(0, windowHeight - (y + height))),
    );
  }, [windowHeight]);

  /**
   * Клавиатуру приходится обходить вручную на обеих платформах: iOS рисует её
   * поверх экрана, а на Android с edge-to-edge окно под неё не сжимается.
   * Высота клавиатуры меряется от низа окна и уже покрывает и таб-бар, и
   * полосу системной навигации — поэтому отступ не сумма, а большее из двух.
   * Считается только от клавиатуры этого поля: поле в шите медиа двигает
   * себя, а не чат под шитом (см. `composerKeyboard`).
   */
  const keyboardInsetStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(keyboardHeight.value - bottomOffset, insets.bottom),
  }));

  return (
    <View
      ref={containerRef}
      onLayout={measureBottomOffset}
      style={[styles.flex, { backgroundColor: theme.background }]}
    >
      <Stack.Screen
        options={
          isSelecting
            ? {
                headerBackVisible: false,
                headerTitle: () => (
                  <ChatHeaderTitle title={`Выбрано: ${selection.selected.length}`} />
                ),
                headerRight: () => (
                  <Pressable
                    accessibilityRole="button"
                    onPress={clearSelection}
                    hitSlop={Spacing.two}
                  >
                    <Text color="primary">Отмена</Text>
                  </Pressable>
                ),
              }
            : {
                headerBackVisible: true,
                headerRight: undefined,
                headerTitle: () => (
                  <ChatHeaderTitle
                    title={chat ? chatTitle(chat, currentUserId) : 'Чат'}
                    subtitle={otherProfile?.status}
                    onPress={other ? () => openPerson(other.id) : undefined}
                  />
                ),
              }
        }
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

        {isSelecting ? (
          <SelectionActionBar
            context={{ selected: selection.selected, currentUserId }}
            onAction={runSelectionAction}
          />
        ) : null}

        {!isMember && myInvite && myInvite.status !== 'accepted' ? (
          isSelecting ? null : (
            <InviteResponseBar
              invite={myInvite}
              responding={invite.pending?.chatId === chatId ? invite.pending.answer : null}
              error={invite.error}
              onAccept={() => invite.respond(chatId, 'accept')}
              onDecline={() => invite.respond(chatId, 'decline')}
            />
          )
        ) : (
          // На время выбора поле ввода прячется, а не размонтируется: черновик
          // и заранее подготовленный рекордер голосовых остаются как были.
          <View style={isSelecting ? styles.hidden : undefined}>
            <MessageComposer
              text={draft.text}
              onChangeText={draft.setText}
              canSend={isMember}
              onSend={submitDraft}
              onTyping={notifyTyping}
              onFieldActivate={claimKeyboardForChat}
              onAttachPressIn={armMediaSheet}
              onAttachPressOut={releaseMediaSheetArm}
              onAttachPress={openMediaSheet}
              onSendVoice={sendVoice}
              onRecordingVoice={notifyRecordingVoice}
            />
          </View>
        )}
      </Animated.View>

      <MediaPickerSheet draft={draft} onTyping={notifyTyping} onSend={submitDraft} />

      <MessageContextMenu
        anchor={menu?.anchor ?? null}
        preview={menu ? bubbleFor(menu.message, false) : null}
        actions={menuActions}
        alignEnd={menu?.message.authorId === currentUserId}
        leadingInset={BUBBLE_LEADING_INSET}
        onAction={(id) => menu && runMessageAction(id, menu.message)}
        onClose={closeMenu}
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
  hidden: {
    display: 'none',
  },
});
