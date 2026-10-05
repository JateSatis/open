import { useIsFocused, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
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
import type { ForwardedComment, IslandOriginal } from '@/api/chats';
import { DeletedOriginal } from '@/features/chats/DeletedOriginal';
import {
  contentOf,
  islandItemKey,
  toChatRows,
  type BubbleRow,
  type ChatListRow,
} from '@/features/chats/islands/rows';
import { useForwardedCommentSources } from '@/features/chats/islands/useForwardedCommentSources';
import { useIslandSources } from '@/features/chats/islands/useIslandSources';
import { MediaPickerSheet } from '@/features/chats/MediaPickerSheet';
import { MessageContextMenu } from '@/features/chats/MessageContextMenu';
import { PinnedBar } from '@/features/chats/PinnedBar';
import {
  canReactTo,
  deletedOriginalActions,
  islandActions,
  visibleMessageActions,
  type IslandActionId,
  type MessageActionId,
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
import { useChatBubbles } from '@/features/chats/useChatBubbles';
import { useChatKeyboardInset } from '@/features/chats/useChatKeyboardInset';
import { useChatRowRenderer } from '@/features/chats/useChatRowRenderer';
import { useComposerDraft } from '@/features/chats/useComposerDraft';
import { useChat } from '@/features/chats/useChat';
import { useChatMessages } from '@/features/chats/useChatMessages';
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
import { CommentsPanel, openComments } from '@/features/interactions/CommentsPanel';
import { useReactToMessage } from '@/features/interactions/useReactToMessage';
import { CallButton } from '@/features/streams/CallButton';
import { ChatCallBar } from '@/features/streams/ChatCallBar';
import { useChatCall } from '@/features/streams/useChatCall';
import { stopVoice } from '@/features/media';
import { showNotice } from '@/features/notifications/alertsStore';
import { useProfile } from '@/features/profile/queries';
import { useTheme } from '@/hooks/use-theme';
import { setActiveChatId } from '@/store/activeChat';
import { Spacing } from '@/theme';

const noop = () => undefined;
const rowKey = (row: ChatListRow) => row.key;

/** Ближе этого к самому новому сообщению список держится за низ переписки, а не за прочитанное. */
const KEEP_READING_POSITION = { minIndexForVisible: 0, autoscrollToTopThreshold: Spacing.six };

/**
 * Облачко чужого сообщения начинается после аватара и зазора (`MessageBubble`).
 * В личном диалоге аватаров нет — облачко у самого края.
 */
const BUBBLE_LEADING_INSET = Spacing.five + Spacing.two;

export default function ChatScreen() {
  const {
    chatId,
    comments: commentsOf,
    comment: focusComment,
  } = useLocalSearchParams<{ chatId: string; comments?: string; comment?: string }>();
  const router = useRouter();
  const nav = useNavigation();
  const theme = useTheme();
  const {
    containerRef,
    onLayout: measureBottomOffset,
    style: keyboardInsetStyle,
  } = useChatKeyboardInset();
  const { width: windowWidth } = useWindowDimensions();
  // Ширина списка — окно минус его боковые поля (`styles.list`).
  const mediaBounds = useMemo(() => mosaicBounds(windowWidth - Spacing.three * 2), [windowWidth]);
  const currentUserId = useCurrentUserId();
  const { chat, isLoading: isChatLoading, error: chatError } = useChat(chatId);
  const chatMessages = useChatMessages(chatId, currentUserId);
  const { messages, isLoading, isLoadingMore, hasMore, error, activities } = chatMessages;
  const { loadMore, retry, notifyTyping, notifyRecordingVoice } = chatMessages;
  const listRef = useRef<FlatList<ChatListRow>>(null);
  const composerRef = useRef<TextInput>(null);
  // Островок раскладывается на строки: плашка и облачка — по строке.
  const rows = useMemo(() => toChatRows(messages), [messages]);
  const pins = usePinnedMessages(chatId);
  const pinCursor = usePinnedCursor(pins.pins);
  const selection = useMessageSelection(rows, currentUserId);
  const jump = useJumpToMessage(listRef, rows, chatMessages.loadUntil);
  const menu = useMessageMenu(rowKey);
  const draft = useComposerDraft(chatId);
  const isMember = chat ? isChatMember(chat, currentUserId) : false;
  const isFocused = useIsFocused();
  // Заявку спрашиваем только у не-участника: участнику отвечать уже не на что.
  const myInvite = useMyInvite(chatId, chat !== null && !isMember);
  const invite = useRespondToInvite();
  const waitingForOthers = useMemo(
    () => (chat?.waiting ?? []).filter((person) => person.id !== currentUserId),
    [chat, currentUserId],
  );
  const navigation = useQuoteNavigation(chatId, jump.jump, !isLoading && !isChatLoading);
  const reactions = useReactToMessage(isMember);
  const call = useChatCall(chatId, chat, currentUserId, isMember);

  // Правки, удаления, реакции и комментарии оригиналов в островках приходят
  // в топики их чатов — слушаем и их.
  useIslandSources(chatId, messages);
  // Пересланные комментарии — ссылки: их правки, удаления и реакции приходят
  // в топики их веток.
  useForwardedCommentSources(chatId, messages);

  // Пока чат открыт, уведомления о нём не нужны: человек и так смотрит сюда.
  useEffect(() => {
    setActiveChatId(chatId);

    return () => setActiveChatId(null);
  }, [chatId]);

  // Плеер голосовых общий на приложение и переживает облачко, уехавшее за
  // экран. Но не чат: закрыл переписку — голосовое замолкает.
  useEffect(() => () => stopVoice(), [chatId]);

  useMarkChatRead(chatId, messages.length > 0 ? messages[0].id : null, isMember);

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

  // Этот чат глазами смотрящего — заголовок островка, если пересылать отсюда,
  // и чат оригинала для сообщений отсюда.
  const thisChat = useMemo(
    () => ({ id: chatId, name: chat ? chatTitle(chat, currentUserId) : 'Чат' }),
    [chat, chatId, currentUserId],
  );

  const originalOf = useCallback(
    (row: BubbleRow): IslandOriginal | null => {
      if (row.type === 'island-item') return row.item.original;

      const { message } = row;
      const author = message.authorId ? participantsById.get(message.authorId) : undefined;

      return {
        ...message,
        authorName: author?.displayName ?? null,
        authorAvatarUrl: author?.avatarUrl ?? null,
        chat: { ...thisChat, readUpTo, amMember: isMember },
      };
    },
    [isMember, participantsById, readUpTo, thisChat],
  );

  const replyForward = useReplyForward({
    chatId,
    sourceChat: thisChat,
    draft,
    authorName,
    originalOf,
    composerRef,
    send: chatMessages.send,
    sendVoice: chatMessages.sendVoice,
    forward: chatMessages.forward,
    forwardComments: chatMessages.forwardComments,
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
    (targets: BubbleRow[]) => afterEdit(() => beginReply(targets)),
    [afterEdit, beginReply],
  );

  const startEdit = useCallback(
    (message: Parameters<typeof beginEdit>[0]) => afterEdit(() => beginEdit(message)),
    [afterEdit, beginEdit],
  );

  const { runMessageAction, runSelectionAction, runIslandAction } = useMessageActionHandlers({
    currentUserId,
    selection,
    pins,
    retry,
    discard: chatMessages.discard,
    deleteMessages: chatMessages.deleteMessages,
    removeFromIsland: chatMessages.removeFromIsland,
    authorName,
    reply: startReply,
    forward: replyForward.startForward,
    edit: startEdit,
    openOriginal: navigation.openOriginal,
    openChat: navigation.openChat,
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

  const selectIsland = useCallback(
    (island: Parameters<typeof runIslandAction>[1]) => runIslandAction('select_all', island),
    [runIslandAction],
  );

  // Пришли из пересланного комментария — его ветка открывается сама, когда
  // чат загружен и известно, участник ли я (от этого ряд моих реакций).
  const openedFocus = useRef(false);

  useEffect(() => {
    if (!commentsOf || !chat || openedFocus.current) return;

    openedFocus.current = true;
    openComments(commentsOf, chatId, isMember, focusComment);
  }, [chat, chatId, commentsOf, focusComment, isMember]);

  const openForwardedComment = useCallback(
    (comment: ForwardedComment) => {
      if (comment.chatId === chatId) {
        openComments(comment.messageId, chatId, isMember, comment.id);
        return;
      }

      router.push({
        pathname: '/chats/[chatId]',
        params: { chatId: comment.chatId, comments: comment.messageId, comment: comment.id },
      });
    },
    [chatId, isMember, router],
  );

  const { bubbleFor, audienceFor, reactToComment } = useChatBubbles({
    chatId,
    currentUserId,
    isMember,
    readUpTo,
    participantsById,
    mediaBounds,
    retry,
    openPerson,
    navigation,
    reactions,
    showAvatars: chat?.kind !== 'direct',
    openForwardedComment,
  });

  const { renderItem, islandHeader } = useChatRowRenderer({
    currentUserId,
    isMember,
    isSelecting,
    isSelected: selection.isSelected,
    toggleSelected: selection.toggle,
    startSelection: selection.start,
    selectIsland,
    editingId,
    highlight: jump.highlight,
    bubbleFor,
    openMenu: menu.open,
    startReply,
    retry,
    hostName: authorName,
  });

  const { toggle: toggleReaction } = reactions;
  const menuRow = menu.target?.item ?? null;
  const menuContent = menuRow && menuRow.type !== 'island-header' ? contentOf(menuRow) : null;
  const menuActions = useMemo(() => {
    if (!menuRow) return [];

    if (menuRow.type === 'island-header') {
      return islandActions(menuRow.island, menuRow.island.authorId === currentUserId);
    }

    const islandMine =
      menuRow.type === 'island-item' ? menuRow.island.authorId === currentUserId : false;

    if (!menuContent) return deletedOriginalActions(islandMine);

    return visibleMessageActions({
      message: menuContent,
      isOwn: menuContent.authorId === currentUserId,
      isMember,
      isPinned: pins.isPinned(menuContent.id),
      island: menuRow.type === 'island-item' ? { isMine: islandMine } : null,
    });
  }, [currentUserId, isMember, menuContent, menuRow, pins]);

  // Реакция из меню — на сообщение, каким оно стало к моменту тапа: пока меню
  // было открыто, моя прежняя реакция могла доехать или откатиться.
  const menuReactions = useMemo(() => {
    if (!menuRow || menuRow.type === 'island-header' || !menuContent) return null;

    // Пересланный комментарий: реакция — его оригиналу.
    const forwarded = menuContent.commentForward?.comment;

    if (menuContent.kind === 'comment_forward') {
      return forwarded && menuContent.status === 'sent'
        ? {
            selected: forwarded.reactions.mine?.emoji ?? null,
            onSelect: (emoji: string) => reactToComment(forwarded, emoji),
          }
        : null;
    }

    if (!canReactTo(menuContent)) return null;

    return {
      selected: menuContent.reactions.mine?.emoji ?? null,
      onSelect: (emoji: string) => {
        const fresh = rows.find((row) => row.key === menuRow.key);
        const latest = fresh && fresh.type !== 'island-header' ? contentOf(fresh) : null;

        toggleReaction(latest ?? menuContent, emoji, audienceFor(menuRow));
      },
    };
  }, [audienceFor, menuContent, menuRow, reactToComment, rows, toggleReaction]);

  const menuPreview = !menuRow ? null : menuRow.type === 'island-header' ? (
    islandHeader(menuRow, false)
  ) : menuContent ? (
    bubbleFor(menuRow, false)
  ) : (
    <DeletedOriginal />
  );

  const runMenuAction = useCallback(
    (id: string) => {
      if (!menuRow) return;

      if (menuRow.type === 'island-header') runIslandAction(id as IslandActionId, menuRow.island);
      else runMessageAction(id as MessageActionId, menuRow);
    },
    [menuRow, runIslandAction, runMessageAction],
  );

  const { jump: jumpTo } = jump;
  const { advance: advancePin } = pinCursor;

  const openPinned = useCallback(
    (pin: { messageId: string; forwardId: string | null; messageCreatedAt: string }) => {
      advancePin();
      // Закреп облачка островка — к его строке в островке.
      const key = pin.forwardId ? islandItemKey(pin.forwardId, pin.messageId) : pin.messageId;

      void jumpTo(key, pin.messageCreatedAt).then((found) => {
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
        right={
          isMember ? (
            <CallButton
              live={call.stream !== null}
              disabled={call.busy}
              onPress={call.startOrJoin}
            />
          ) : undefined
        }
      />

      <Animated.View testID="chat-keyboard-area" style={[styles.flex, keyboardInsetStyle]}>
        {/* Звонок срочнее закрепа: он идёт прямо сейчас. */}
        <ChatCallBar
          stream={call.stream}
          isInThisCall={call.isInThisCall}
          isMember={isMember}
          onPress={call.openBar}
        />

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
            data={rows}
            onScrollToIndexFailed={jump.onScrollToIndexFailed}
            keyExtractor={rowKey}
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
            // Тап по облачку при открытой клавиатуре сразу открывает меню, а
            // не только прячет клавиатуру; тап по пустому месту — прячет.
            keyboardShouldPersistTaps="handled"
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

      {/* Сторы шитов общие: в стеке бывает два экрана чата (переход по
          цитате, островку, из профиля), и окно рисует только верхний — иначе
          под закрывающимся шитом на миг показывался его двойник. */}
      {isFocused ? (
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
      ) : null}

      <MessageContextMenu
        anchor={menu.target?.anchor ?? null}
        preview={menuPreview}
        actions={menuActions}
        reactions={menuReactions}
        alignEnd={menuContent?.authorId === currentUserId}
        leadingInset={
          menuRow?.type === 'island-header' || chat?.kind === 'direct' ? 0 : BUBBLE_LEADING_INSET
        }
        onAction={runMenuAction}
        onClose={menu.close}
      />

      <CommentsPanel onOpenPerson={openPerson} hostChatId={chatId} />
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
