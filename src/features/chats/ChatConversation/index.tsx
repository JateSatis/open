import { useQueryClient } from '@tanstack/react-query';
import { useIsFocused, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Keyboard,
  useWindowDimensions,
  View,
  type TextInput,
} from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { styles } from './styles';

import type { ChannelRef, ForwardedComment, IslandOriginal } from '@/api/chats';
import type { Pop } from '@/api/pops';
import type { DraftPop } from '@/features/chats/composerDraftStore';
import type { LiveQuote } from '@/features/chats/messages/types';
import { LoadFailed } from '@/components/LoadFailed';
import { Text } from '@/components/Text';
import { useMarkChannelSectionRead } from '@/features/channels/useMarkChannelSectionRead';
import { subscribersLabel } from '@/features/channels/subscriberText';
import { ChatFooter, modePlate } from '@/features/chats/ChatFooter';
import { ChatMenu } from '@/features/chats/ChatMenu';
import { ChatScreenHeader } from '@/features/chats/ChatScreenHeader';
import { DeletedOriginal } from '@/features/chats/DeletedOriginal';
import {
  commentsHomeOf,
  contentOf,
  islandItemKey,
  toChatRows,
  type BubbleRow,
  type ChatListRow,
} from '@/features/chats/islands/rows';
import { useForwardedCommentSources } from '@/features/chats/islands/useForwardedCommentSources';
import { useIslandSources } from '@/features/chats/islands/useIslandSources';
import {
  closeMediaSheet,
  GALLERY_ONLY,
  gallerySection,
  MediaPickerSheet,
  type SheetSection,
} from '@/features/chats/MediaPickerSheet';
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
  dialogPair,
  isChatMember,
  readUpTo as readUpToOf,
} from '@/features/chats/chatDisplay';
import { mosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { bubbleAsideWidth } from '@/features/chats/MessageBubble/layout';
import { measureInWindow, RowRegistryContext } from '@/features/chats/rowRegistry';
import { useChatBubbles } from '@/features/chats/useChatBubbles';
import { useChatKeyboardInset } from '@/features/chats/useChatKeyboardInset';
import { useChatRowRenderer } from '@/features/chats/useChatRowRenderer';
import { useComposerDraft } from '@/features/chats/useComposerDraft';
import { chatQueryKey, useChat } from '@/features/chats/useChat';
import { useCommentsLiftHost } from '@/features/chats/useCommentsLiftHost';
import { useChatMessages } from '@/features/chats/useChatMessages';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { useJumpToMessage } from '@/features/chats/useJumpToMessage';
import { useMarkChatRead } from '@/features/chats/useMarkChatRead';
import {
  useChatSubscription,
  useMarkChatSubscriptionRead,
} from '@/features/chats/chatSubscription';
import { useMessageViews } from '@/features/chats/useMessageViews';
import { messagesQueryKey } from '@/features/chats/messages/historyCache';
import { readChatDraft } from '@/features/chats/composerDraftStore';
import { useMessageActionHandlers } from '@/features/chats/useMessageActionHandlers';
import { useMessageEdit } from '@/features/chats/useMessageEdit';
import { useMessageMenu } from '@/features/chats/useMessageMenu';
import { useMessageSelection } from '@/features/chats/useMessageSelection';
import { useMyInvite } from '@/features/chats/useMyInvite';
import { usePinnedCursor } from '@/features/chats/usePinnedCursor';
import { usePinnedMessages } from '@/features/chats/usePinnedMessages';
import { useQuoteNavigation, type CommentFocus } from '@/features/chats/useQuoteNavigation';
import { useReplyForward } from '@/features/chats/useReplyForward';
import { useRespondToInvite } from '@/features/chats/useRespondToInvite';
import { WaitingBanner } from '@/features/chats/WaitingBanner';
import { CommentsPanel, openComments } from '@/features/interactions/CommentsPanel';
import { resetScrolledRows } from '@/features/interactions/MessageReactions';
import { menuReactionSet } from '@/features/interactions/reactionState';
import { chatFade } from '@/features/interactions/comments/commentsLift';
import { useReactToMessage } from '@/features/interactions/useReactToMessage';
import { CallButton } from '@/features/streams/CallButton';
import { ChatCallBar } from '@/features/streams/ChatCallBar';
import { useChatCall } from '@/features/streams/useChatCall';
import { reloadMissing } from '@/lib/loadState';
import { stopVoice } from '@/features/media';
import { showNotice } from '@/features/notifications/alertsStore';
import { useMyProfile, useProfile } from '@/features/profile/queries';
import { openPopViewer } from '@/features/pops/openPopViewer';
import { useTheme } from '@/hooks/use-theme';
import { setActiveChatId } from '@/store/activeChat';
import { Spacing } from '@/theme';

const noop = () => undefined;
const rowKey = (row: ChatListRow) => row.key;

/** Ближе этого к самому новому сообщению список держится за низ переписки, а не за прочитанное. */
const KEEP_READING_POSITION = { minIndexForVisible: 0, autoscrollToTopThreshold: Spacing.six };
/** Положение прокрутки нужно учёту просмотров лишь примерно: у низа или нет. */
const VIEWS_SCROLL_THROTTLE_MS = 100;

export type ChatConversationProps = {
  chatId: string;
  /**
   * Канал, чьи это посты. Переписка тогда — лента постов: облачка у левого
   * края и шире, подписаны каналом, без аватаров и свайпа для ответа; звонка
   * нет, а постороннему не показывается поле ввода.
   */
  channel?: ChannelRef | null;
  /**
   * Переписку видно. На экране канала раздел «Посты» остаётся смонтированным,
   * когда открыты «Попсы», — просмотры и прочтение тогда не засчитываются.
   */
  active?: boolean;
  /**
   * Свои разделы шита медиа после галереи — у канала это «Pop». Переписка о
   * них не знает: она даёт лишь способ прикрепить поп к посту.
   */
  sheetSections?: (context: { attachPop: (pop: Pop) => void }) => SheetSection[];
  /**
   * Шапка канала: подпись под названием и правая часть. Их знает экран
   * канала — подпись зависит от открытого раздела, а не от «Постов».
   */
  channelHeader?: { subtitle: string | null; right: ReactNode };
};

/**
 * Переписка целиком: шапка (через опции экрана), список, поле ввода, шиты,
 * меню и комментарии. Её показывают и экран чата, и раздел «Посты» канала.
 */
export function ChatConversation({
  chatId,
  channel = null,
  active = true,
  sheetSections: extraSections,
  channelHeader,
}: ChatConversationProps) {
  const router = useRouter();
  const nav = useNavigation();
  const theme = useTheme();
  const {
    containerRef,
    onLayout: measureBottomOffset,
    style: keyboardInsetStyle,
  } = useChatKeyboardInset();
  const { width: windowWidth } = useWindowDimensions();
  // Ширина списка — окно минус его боковые поля (`styles.list`). Рядом с
  // мозаикой в строке — место круга комментариев и, кроме постов, аватар.
  const isPosts = channel !== null;
  const mediaBounds = useMemo(
    () => mosaicBounds(windowWidth - Spacing.three * 2, isPosts, bubbleAsideWidth(!isPosts)),
    [isPosts, windowWidth],
  );
  const currentUserId = useCurrentUserId();
  const { chat, isLoading: isChatLoading, failed: chatFailed } = useChat(chatId);
  const chatMessages = useChatMessages(chatId, currentUserId);
  const { messages, isLoading, isLoadingMore, hasMore, error, activities } = chatMessages;
  // Чат или его история не загрузились, и показать нечего: вместо крутилки —
  // «не удалось» с повтором. Упавшее обновление поверх данных сюда не попадает.
  const failed = chatFailed || chatMessages.failed;
  const queryClient = useQueryClient();
  const reload = useCallback(
    () => reloadMissing(queryClient, [chatQueryKey(chatId), messagesQueryKey(chatId)]),
    [chatId, queryClient],
  );
  const { loadMore, retry, notifyTyping, notifyRecordingVoice } = chatMessages;
  const listRef = useRef<FlatList<ChatListRow>>(null);
  const composerRef = useRef<TextInput>(null);
  // Островок раскладывается на строки: плашка и облачка — по строке.
  const rows = useMemo(() => toChatRows(messages), [messages]);
  const pins = usePinnedMessages(chatId);
  const pinCursor = usePinnedCursor(pins.pins);
  const selection = useMessageSelection(rows, currentUserId);
  const jump = useJumpToMessage(listRef, rows, chatMessages.loadUntil);
  const listFrameRef = useRef<View>(null);
  const measureListFrame = useCallback(() => measureInWindow(listFrameRef.current), []);
  const menu = useMessageMenu<ChatListRow>(measureListFrame);
  const draft = useComposerDraft(chatId);
  const isMember = chat ? isChatMember(chat, currentUserId) : false;
  const isFocused = useIsFocused() && active;
  // Заявку спрашиваем только у не-участника: участнику отвечать уже не на что.
  const myInvite = useMyInvite(chatId, chat !== null && !isMember);
  const invite = useRespondToInvite();
  const hasOpenInvite = Boolean(myInvite && myInvite.status !== 'accepted');
  // Подписка — на чужой диалог или группу; у канала она своя, через канал.
  const subscription = useChatSubscription(chatId, !isPosts && chat !== null && !isMember);
  const waitingForOthers = useMemo(
    () => (chat?.waiting ?? []).filter((person) => person.id !== currentUserId),
    [chat, currentUserId],
  );
  const { jump: jumpTo } = jump;
  // Прыжок к сообщению бывает долгим (догрузка истории): если за это время
  // ушли с экрана, шит не открывается — он лёг бы поверх чужого.
  const focusedRef = useRef(isFocused);

  useEffect(() => {
    focusedRef.current = isFocused;

    return () => {
      focusedRef.current = false;
    };
  }, [isFocused]);

  // Пришли к комментарию (тап по пересланному): переписка прокручивается к
  // сообщению, под которым он оставлен, и оно поднимается над шитом с этого
  // места. Удалённого или не найденного нет — только шит, и это не ошибка.
  const focusComment = useCallback(
    (focus: CommentFocus) => {
      const open = (rowKey?: string) =>
        openComments(
          focus.messageId,
          chatId,
          isMember,
          focus.commentId,
          rowKey ? { rowKey, settle: true } : undefined,
        );
      const { target } = focus;

      if (!target) {
        open();
        return;
      }

      void jumpTo(target.key, target.createdAt).then((found) => {
        if (focusedRef.current) open(found ? target.key : undefined);
      });
    },
    [chatId, isMember, jumpTo],
  );

  const navigation = useQuoteNavigation(chatId, {
    jump: jump.jump,
    isHistoryReady: !isLoading && !isChatLoading,
    isFocused,
    focusComment,
  });
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

  const newestMessageId = messages.length > 0 ? messages[0].id : null;

  useMarkChatRead(chatId, newestMessageId, isMember);
  // Подписчик чужого диалога — своей отметкой в подписке.
  useMarkChatSubscriptionRead(
    chatId,
    newestMessageId,
    isFocused && !isPosts && Boolean(subscription),
  );
  // Подписчик канала — своей отметкой: участником чата постов он не бывает.
  useMarkChannelSectionRead(
    channel?.id ?? null,
    'posts',
    newestMessageId,
    isFocused && chat !== null && !isMember,
  );

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

  // Я как поставивший реакцию — из участников: там свежий аватар.
  // Посетителя среди участников нет — тогда из моего профиля.
  const { data: myProfile } = useMyProfile();
  const me = useMemo(() => {
    if (!currentUserId) return undefined;

    const self = participantsById.get(currentUserId);

    return {
      userId: currentUserId,
      name: self?.displayName ?? myProfile?.displayName ?? null,
      avatarUrl: self ? self.avatarUrl : (myProfile?.avatarUrl ?? null),
    };
  }, [currentUserId, myProfile, participantsById]);
  const reactions = useReactToMessage(isMember, me);

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

  // Пост с попом — только в «Постах» канала.
  const { sendPop: sendPopTo } = chatMessages;
  const channelId = channel?.id ?? null;
  const sendPop = useMemo(
    () =>
      channelId
        ? (text: string, pop: DraftPop, replies?: LiveQuote[]) =>
            sendPopTo(channelId, text, pop, replies)
        : undefined,
    [channelId, sendPopTo],
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
    sendPop,
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

  // Комментарии облачка островка — у оригинала: панель на него, из его чата.
  const commentOn = useCallback(
    (row: BubbleRow) => {
      const message = contentOf(row);

      if (!message) return;

      const home = commentsHomeOf(row, chatId, isMember);

      openComments(message.id, home.chatId, home.amMember, undefined, { rowKey: row.key });
    },
    [chatId, isMember],
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
    comment: commentOn,
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

  const { openComment } = navigation;
  const openForwardedComment = useCallback(
    (comment: ForwardedComment) => {
      // Комментарий к попу — в просмотре попа, с открытыми комментариями.
      // Поп удалён — идти некуда.
      if (comment.subject.type === 'pop') {
        if (comment.pop) {
          openPopViewer(comment.pop.channelId, comment.pop.id, { focusCommentId: comment.id });
        }

        return;
      }

      openComment(comment.chatId, {
        messageId: comment.subject.id,
        commentId: comment.id,
        target: comment.target
          ? { key: comment.target.id, createdAt: comment.target.createdAt }
          : null,
      });
    },
    [openComment],
  );

  const { bubbleFor, audienceFor, reactToComment } = useChatBubbles({
    chatId,
    currentUserId,
    isMember,
    participantsById,
    mediaBounds,
    retry,
    openPerson,
    navigation,
    reactions,
    showAvatars: chat?.kind !== 'direct' && !isPosts,
    openForwardedComment,
    postAuthor: channel?.title ?? null,
  });

  const { renderItem, islandHeader, bubbleContent } = useChatRowRenderer({
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
    // В постах свайп листает разделы канала; ответить можно из меню.
    swipeReply: !isPosts,
    retry,
    hostName: authorName,
  });

  const commentsLift = useCommentsLiftHost(listRef, rows, bubbleContent);
  const views = useMessageViews({
    chatId,
    currentUserId,
    isFocused,
    rows,
    autoscrollThreshold: KEEP_READING_POSITION.autoscrollToTopThreshold,
    measureRow: commentsLift.registry.measure,
    measureViewport: measureListFrame,
  });

  // Прокрутили переписку — прокрученные вбок ряды реакций возвращаются в начало.
  const { onScroll: viewsOnScroll } = views;
  const onListScroll = useCallback(
    (event: Parameters<typeof viewsOnScroll>[0]) => {
      viewsOnScroll(event);
      resetScrolledRows();
    },
    [viewsOnScroll],
  );

  // Пока открыт шит комментариев, переписка под ним растворена.
  const fadeStyle = useAnimatedStyle(() => ({ opacity: chatFade.value }));

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
            ...menuReactionSet(forwarded.reactions, 'comment'),
            selected: forwarded.reactions.mine?.emoji ?? null,
            onSelect: (emoji: string) => reactToComment(forwarded, emoji),
          }
        : null;
    }

    if (!canReactTo(menuContent)) return null;

    // Набор — по ряду, куда ляжет моя реакция: у облачка островка — по
    // участию в чате оригинала. Берётся на момент открытия меню.
    return {
      ...menuReactionSet(menuContent.reactions, audienceFor(menuRow)),
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

  // Разделы шита медиа по виду чата: в «Постах» канала к галерее добавляется
  // «Pop». Поп и галерея в одном посте несовместимы — пока поп прикреплён,
  // галерея притушена.
  const { pop: draftPop, setPop } = draft;
  const attachPop = useCallback(
    (pop: Pop) => {
      setPop({ type: 'existing', pop });
      closeMediaSheet();
    },
    [setPop],
  );
  const sheetSections = useMemo(
    () =>
      extraSections
        ? [gallerySection({ locked: draftPop !== null }), ...extraSections({ attachPop })]
        : GALLERY_ONLY,
    [attachPop, draftPop, extraSections],
  );
  const popChip = draftPop
    ? {
        posterUri: draftPop.type === 'existing' ? draftPop.pop.posterUrl : draftPop.posterUri,
        onRemove: () => setPop(null),
      }
    : null;

  const title = channel ? channel.title : chat ? chatTitle(chat, currentUserId) : 'Чат';
  // Чужой личный диалог — двое внахлёст, как в «Чатах».
  const pair = !channel && chat ? dialogPair(chat, currentUserId) : null;
  // Под названием — число подписчиков для всех; у участника диалога — рядом
  // со статусом собеседника.
  const chatSubtitle = chat
    ? [otherProfile?.status, subscribersLabel(chat.subscribersCount)].filter(Boolean).join(' · ')
    : otherProfile?.status;

  return (
    <View
      ref={containerRef}
      onLayout={measureBottomOffset}
      style={[styles.flex, { backgroundColor: theme.background }]}
    >
      <ChatScreenHeader
        title={title}
        avatar={
          channel
            ? { uri: channel.avatarUrl, name: channel.title }
            : pair && pair.length === 2
              ? [
                  { uri: pair[0].avatarUrl, name: pair[0].displayName },
                  { uri: pair[1].avatarUrl, name: pair[1].displayName },
                ]
              : undefined
        }
        subtitle={channel ? (channelHeader?.subtitle ?? null) : chatSubtitle}
        onTitlePress={other ? () => openPerson(other.id) : undefined}
        selectedCount={selection.selected.length}
        onCancelSelection={clearSelection}
        right={
          isPosts ? (
            channelHeader?.right
          ) : isMember ? (
            <View style={styles.headerActions}>
              <CallButton
                live={call.stream !== null}
                disabled={call.busy}
                onPress={call.startOrJoin}
              />
              <ChatMenu chatId={chatId} isMember subscription={null} />
            </View>
          ) : chat ? (
            <ChatMenu chatId={chatId} isMember={false} subscription={subscription} />
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

        {failed ? (
          <LoadFailed message="Не удалось загрузить переписку" onRetry={reload} />
        ) : isChatLoading || isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator accessibilityLabel="Загрузка переписки" />
          </View>
        ) : (
          <Animated.View ref={listFrameRef} style={[styles.flex, fadeStyle]}>
            <RowRegistryContext.Provider value={commentsLift.registry}>
              <FlatList
                ref={listRef}
                testID="messages-list"
                inverted
                data={rows}
                onScrollToIndexFailed={jump.onScrollToIndexFailed}
                keyExtractor={rowKey}
                renderItem={renderItem}
                viewabilityConfig={views.viewabilityConfig}
                onViewableItemsChanged={views.onViewableItemsChanged}
                onScroll={onListScroll}
                scrollEventThrottle={VIEWS_SCROLL_THROTTLE_MS}
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
            </RowRegistryContext.Provider>
          </Animated.View>
        )}

        {!failed && !isChatLoading && !isLoading && messages.length === 0 ? (
          <View style={styles.centered}>
            <Text color="textSecondary">
              {isPosts
                ? 'Постов пока нет.'
                : 'Сообщений пока нет. Всё, что здесь появится, сможет прочитать кто угодно.'}
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.banner}>
            <Text variant="small" color="danger">
              {error}
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
            !isMember && myInvite && hasOpenInvite
              ? {
                  value: myInvite,
                  responding: invite.pending?.chatId === chatId ? invite.pending.answer : null,
                  error: invite.error,
                  onAccept: () => invite.respond(chatId, 'accept'),
                  onDecline: () => invite.respond(chatId, 'decline'),
                }
              : null
          }
          subscribe={
            !isPosts &&
            chat !== null &&
            !isMember &&
            // Заявки нет вовсе: принятая — значит, я вот-вот появлюсь среди
            // участников, отклонённая — её панель и так внизу.
            myInvite === null &&
            subscription === null
              ? { chatId }
              : null
          }
          // Постороннему писать некуда: поле ввода не показывается вовсе. Пока
          // чат грузится, оно смонтировано с надписью вместо поля (`canSend`
          // ложно): смонтированное заранее, оно встаёт над клавиатурой вовремя.
          // Переписка не загрузилась — писать некуда, пока она не откроется.
          composer={
            failed || (!isMember && (isPosts || chat !== null))
              ? null
              : {
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
                  pop: isEditing ? null : popChip,
                }
          }
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
          title={title}
          onTyping={notifyTyping}
          onSend={submit}
          sections={sheetSections}
        />
      ) : null}

      <MessageContextMenu
        anchor={menu.target?.anchor ?? null}
        viewport={menu.target?.viewport ?? null}
        preview={menuPreview}
        actions={menuActions}
        reactions={menuReactions}
        onAction={runMenuAction}
        onClose={menu.close}
      />

      <CommentsPanel onOpenPerson={openPerson} hostChatId={chatId} lift={commentsLift.host} />
    </View>
  );
}
