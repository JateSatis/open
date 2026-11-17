import { useQueryClient } from '@tanstack/react-query';
import { useIsFocused, useNavigation, useRouter } from '@/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextInput,
} from 'react-native';
import Animated from 'react-native-reanimated';

import { styles } from './styles';
import {
  HistoryCell,
  HistoryLayouts,
  useInitialHistoryRows,
  useReadingPlace,
} from './useReadingPlace';
import { useAttachedHistoryRows } from './useAttachedHistoryRows';

import { isOpaquePersonId } from '@/api/opaquePeople';
import type { ChannelRef, IslandOriginal, Person } from '@/api/chats';
import type { Pop } from '@/api/pops';
import type { DraftPop } from '@/features/chats/composerDraftStore';
import type { LiveQuote } from '@/features/chats/messages/types';
import { LoadFailed } from '@/components/LoadFailed';
import {
  useSlidePageBack,
  useSlidePageLeaveGuard,
  useSlidePageSwipeStart,
} from '@/components/SlidePage';
import { Text } from '@/components/Text';
import { useHistoryOpening } from './useHistoryOpening';
import type { ReadingPlace } from '../messages/local/segments';
import { localHistory } from '../messages/local/database';
import { stillReader } from '../messages/local/reader';
import { loadPage, projection } from '../messages/local/loader';
import { subscribersLabel } from '@/features/channels/subscriberText';
import { ChatFooter, modePlate } from '@/features/chats/ChatFooter';
import { ChatMenu } from '@/features/chats/ChatMenu';
import { ChatThreadPanel, type ChatThreadPanelKit } from '@/features/chats/ChatThreadPanel';
import { ChatThreadsToggle } from '@/features/chats/ChatThreadsToggle';
import {
  closeChatThread,
  openedChatThread,
} from '@/features/chats/chatThreads/chatThreadPanelStore';
import { useChatThreadPlates } from '@/features/chats/chatThreads/useChatThreadPlates';
import { useChatThreadReplies } from '@/features/chats/chatThreads/useChatThreadReplies';
import { useChatThreadsView } from '@/features/chats/chatThreads/useChatThreadsMode';
import type { HiddenRange } from '@/features/chats/hiddenText';
import type { LocalMedia, OutgoingMedia } from '@/features/media';
import { ChatScreenHeader } from '@/features/chats/ChatScreenHeader';
import { closeEmojiPanel } from '@/features/chats/EmojiPanel/useEmojiPanel';
import { ChatSearchHeader } from '@/features/chats/chatSearch/ChatSearchHeader';
import { ChatSearchPlate } from '@/features/chats/chatSearch/ChatSearchPlate';
import { ChatSearchResults } from '@/features/chats/chatSearch/ChatSearchResults';
import { useChatSearch } from '@/features/chats/chatSearch/useChatSearch';
import { DeletedOriginal } from '@/features/chats/DeletedOriginal';
import {
  commentsHomeOf,
  contentOf,
  toChatRows,
  rowRenderKey,
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
import {
  createRowRegistry,
  measureInWindow,
  RowRegistryContext,
} from '@/features/chats/rowRegistry';
import { useChatBubbles } from '@/features/chats/useChatBubbles';
import { useChatKeyboardInset } from '@/features/chats/useChatKeyboardInset';
import { useChatRowRenderer } from '@/features/chats/useChatRowRenderer';
import { FragmentMenu } from '@/features/chats/fragments/FragmentMenu';
import { commentOnSelection } from '@/features/chats/fragments/openFragmentPanel';
import { clearTextSelection, type TextSelection } from '@/features/chats/fragments/fragmentStore';
import { useFragmentMode } from '@/features/chats/fragments/useFragmentMode';
import { registerSelectionScroller } from '@/features/chats/fragments/selectionAutoScroll';
import { useComposerDraft } from '@/features/chats/useComposerDraft';
import { chatQueryKey, useChat } from '@/features/chats/useChat';
import { useChatMessages } from '@/features/chats/useChatMessages';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { useMarkChatRead } from '@/features/chats/useMarkChatRead';
import { useChatSubscription } from '@/features/chats/chatSubscription';
import { useChatJournal } from '@/features/chats/useChatJournal';
import { useMessageViews } from '@/features/chats/useMessageViews';
import { messagesQueryKey } from '@/features/chats/messages/historyCache';
import { readChatDraft } from '@/features/chats/composerDraftStore';
import { useMessageActionHandlers } from '@/features/chats/useMessageActionHandlers';
import { useMessageEdit } from '@/features/chats/useMessageEdit';
import { useMessageMenu } from '@/features/chats/useMessageMenu';
import { isSelectableRow, useMessageSelection } from '@/features/chats/useMessageSelection';
import { useMyInvite } from '@/features/chats/useMyInvite';
import { usePinnedCursor } from '@/features/chats/usePinnedCursor';
import { usePinnedMessages } from '@/features/chats/usePinnedMessages';
import { useReplyForward } from '@/features/chats/useReplyForward';
import { useRespondToInvite } from '@/features/chats/useRespondToInvite';
import { WaitingBanner } from '@/features/chats/WaitingBanner';
import { CommentsPanel, openComments } from '@/features/interactions/CommentsPanel';
import { resetScrolledRows } from '@/features/interactions/MessageReactions';
import { menuReactionSet } from '@/features/interactions/reactionState';
import { useReactToMessage } from '@/features/interactions/useReactToMessage';
import { TileViewportContext } from '@/features/media/tileRegistry';
import { CallButton } from '@/features/streams/CallButton';
import { ChatCallBar } from '@/features/streams/ChatCallBar';
import { useChatCall } from '@/features/streams/useChatCall';
import { reloadMissing } from '@/lib/loadState';
import { stopVoice } from '@/features/media';
import { useMyProfile, useProfile } from '@/features/profile/queries';
import { useTheme } from '@/hooks/use-theme';
import { setActiveChatId } from '@/store/activeChat';
import { Spacing } from '@/theme';

const noop = () => undefined;

/** Ближе этого к самому новому сообщению список держится за низ переписки, а не за прочитанное. */
const KEEP_READING_POSITION = { minIndexForVisible: 0, autoscrollToTopThreshold: Spacing.six };
/** Не отбрасывать конечную позицию короткого жеста внутри VirtualizedList. */
const LIST_SCROLL_THROTTLE_MS = 16;
/** Столько после шага автопрокрутки выделения события прокрутки не двигают её смещение. */
const AUTO_SCROLL_QUIET_MS = 300;
/** Ближе этой доли экрана к старейшему сообщению — пора догружать историю. */
const HISTORY_EDGE = 0.4;
const HISTORY_PREFETCH_SCREENS = 2;
// На быстрых свайпах две высоты дают меньше полусекунды до старого края.
const OLDER_PREFETCH_SCREENS = 5;
// На первом быстром броске 20 стартовых элементов могут закончиться раньше
// ответа. Дальше работает обычное окно предзагрузки, по 50 элементов.
const FLING_LOOKAHEAD_MS = 950;
const MAX_FLING_LOOKAHEAD_SCREENS = 14;

function atHistoryEdge(
  { contentOffset, contentSize, layoutMeasurement }: NativeScrollEvent,
  screens = HISTORY_EDGE,
) {
  // Список перевёрнут: старые сообщения — у конца содержимого.
  return (
    layoutMeasurement.height > 0 &&
    contentSize.height - layoutMeasurement.height - contentOffset.y <
      layoutMeasurement.height * screens
  );
}

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
  channelHeader?: { subtitle: string | null; right: ReactNode; onTitlePress?: () => void };
};

/**
 * Переписка целиком: шапка (через опции экрана), список, поле ввода, шиты,
 * меню и комментарии. Её показывают и экран чата, и раздел «Посты» канала.
 */
export function ChatConversation(props: ChatConversationProps) {
  const reader = useCurrentUserId();
  return <HistoryOpening key={reader + '/' + props.chatId} {...props} />;
}

function HistoryOpening(props: ChatConversationProps) {
  const focused = useIsFocused();
  const opening = useHistoryOpening(props.chatId, focused && props.active !== false);
  if (!opening.ready)
    return opening.failed ? (
      <LoadFailed message="Не удалось загрузить переписку" onRetry={opening.retry} />
    ) : (
      <ActivityIndicator />
    );
  return (
    <Conversation {...props} initialPlace={opening.place ?? null} eligible={opening.eligible} />
  );
}

function Conversation({
  initialPlace,
  eligible,
  chatId,
  channel = null,
  active = true,
  sheetSections: extraSections,
  channelHeader,
}: ChatConversationProps & { initialPlace: ReadingPlace | null; eligible: boolean }) {
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
  const { chat, isLoading: isChatLoading, failed: chatFailed, gone } = useChat(chatId);
  const chatThreads = useChatThreadsView(chat);
  const threadsActive = chatThreads.view === 'chat-threads';
  const chatMessages = useChatMessages(chatId, currentUserId, chatThreads.view);
  const { messages, isLoading, isLoadingMore, hasMore, error, activities } = chatMessages;
  // Показать нечего, а загрузить не вышло: вместо крутилки — «не удалось» с
  // повтором. Упавшее обновление поверх данных сюда не попадает, как и упавший
  // чат при уже загруженных сообщениях: их видно и без него.
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
  const diskWindow = useInitialHistoryRows(rows, initialPlace);
  const presentedRows = useAttachedHistoryRows(
    threadsActive ? rows : diskWindow.rows,
    `${currentUserId}/${chatId}/${chatThreads.view}`,
  );
  const pins = usePinnedMessages(chatId);
  const pinCursor = usePinnedCursor(pins.pins);
  const selection = useMessageSelection(rows, currentUserId);
  const listFrameRef = useRef<View>(null);
  const measureListFrame = useCallback(() => measureInWindow(listFrameRef.current), []);
  // Строки на экране — для засчитанных показов: меряются снаружи списка по ключу.
  const [rowRegistry] = useState(createRowRegistry);
  const scrollState = useRef({ offset: 0, content: 0, viewport: 0, drivenAt: 0 });
  const failed = (chatMessages.failed || chatFailed) && messages.length === 0;
  // Список другого вида начинается заново — у самого низа.
  useEffect(() => {
    scrollState.current.offset = 0;
  }, [chatThreads.view]);
  // Поиск по чату — со страницы чата: поле вместо шапки, плашка вместо поля ввода.
  const focused = useIsFocused();
  const chatSearch = useChatSearch(chatId);
  const [searchListShown, setSearchListShown] = useState(false);
  const showSearchList = chatSearch.active && searchListShown;
  const markRead = useMarkChatRead(chatId, eligible && !showSearchList);
  const place = useReadingPlace(
    chatId,
    initialPlace,
    presentedRows,
    focused && active && !threadsActive,
    listRef,
    scrollState,
    listFrameRef,
    markRead,
  );
  const { close: closeSearch } = chatSearch;
  const leaveSearch = useCallback(() => {
    setSearchListShown(false);
    closeSearch();
  }, [closeSearch]);
  const menu = useMessageMenu<ChatListRow>(measureListFrame);
  const draft = useComposerDraft(chatId);
  const isMember = chat ? isChatMember(chat, currentUserId) : false;
  // Моя заявка на диалог ещё не принята: одно сообщение уже ушло, дальше ждать.
  const requestSent = Boolean(chat?.requestPending && chat.createdBy === currentUserId);
  const isFocused = focused && active && !place.hidden;
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

  const readUpTo = useMemo(() => readUpToOf(chat, currentUserId), [chat, currentUserId]);

  // Собеседник личного диалога: его статус — в шапке, тап по шапке — его профиль.
  const other = chat ? counterpart(chat, currentUserId) : null;
  const { data: otherProfile } = useProfile(other?.id);

  const openPerson = useCallback(
    (personId: string) => {
      if (personId === currentUserId) {
        router.navigate({ name: 'Tabs', params: { screen: 'profile' } });
        return;
      }

      // Подменённый в диалоге: id непрозрачный, профиля за ним нет.
      if (isOpaquePersonId(personId)) return;

      router.push({ name: 'Person', params: { userId: personId } });
    },
    [currentUserId, router],
  );

  const participantsById = useMemo(
    () => new Map((chat?.participants ?? []).map((participant) => [participant.id, participant])),
    [chat],
  );

  // Кто писал в переписке: участники и те, кого среди них уже нет (ушли,
  // удалены из группы), — их имя и аватар приходят с самим сообщением. Карта
  // пересобирается, только когда меняется состав таких авторов: новое
  // сообщение не должно перерисовывать все облачка.
  const departed = useMemo(() => {
    const authors = new Map<string, Person>();

    for (const message of messages) {
      const { authorId, author } = message;

      if (authorId && author && !participantsById.has(authorId) && !authors.has(authorId)) {
        authors.set(authorId, { id: authorId, ...author });
      }
    }

    return authors;
  }, [messages, participantsById]);
  const peopleById = useMemo(() => {
    const people = new Map<string, Person>(departed);

    participantsById.forEach((participant, id) => people.set(id, participant));

    return people;
  }, [departed, participantsById]);

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
      (authorId ? peopleById.get(authorId)?.displayName : undefined) ?? DELETED_ACCOUNT,
    [peopleById],
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
      const author = message.authorId ? peopleById.get(message.authorId) : undefined;

      return {
        ...message,
        authorName: author?.displayName ?? null,
        authorAvatarUrl: author?.avatarUrl ?? null,
        chat: { ...thisChat, readUpTo, amMember: isMember, isChannelPosts: isPosts },
      };
    },
    [isMember, isPosts, peopleById, readUpTo, thisChat],
  );

  // Пост с попом — только в «Постах» канала.
  const jumpAfterSend = useRef<string | null>(null);
  const { sendPop: sendPopTo } = chatMessages;
  const channelId = channel?.id ?? null;
  const sendPop = useMemo(
    () =>
      channelId
        ? (text: string, pop: DraftPop, replies?: LiveQuote[]) => {
            jumpAfterSend.current = sendPopTo(channelId, text, pop, replies);
          }
        : undefined,
    [channelId, sendPopTo],
  );

  // В «Тредах» свой ответ в ленте не встаёт: плашка корня меняется сразу, а
  // всплывашка ведёт в его тред.
  const { send: sendToChat, sendVoice: sendVoiceToChat } = chatMessages;
  const jumpGeneration = useRef(0);
  useEffect(
    () => () => {
      jumpGeneration.current++;
    },
    [isFocused, chatId],
  );
  useEffect(() => {
    if (!jumpAfterSend.current || !currentUserId || !isFocused || threadsActive) return;
    const mine = messages.find((m) => m.localId === jumpAfterSend.current && m.status === 'sent');
    if (!mine) return;
    jumpAfterSend.current = null;
    const generation = ++jumpGeneration.current;
    const current = () => generation === jumpGeneration.current && stillReader(currentUserId);
    const scope = { reader: currentUserId, chat: chatId };
    const target = { messageId: mine.id, key: mine.id, seq: mine.seq, position: 0, offset: 0 };
    const reveal = () => {
      if (!current()) return;
      place.interrupt();
      diskWindow.revealLatest();
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
      place.settled();
    };
    void loadPage(scope, { mode: 'around', messageId: mine.id, limit: 30 }, current)
      .then(() => {
        if (!current()) return;
        const cached = projection(scope, localHistory().read(scope, target));
        if (cached?.items.some((m) => m.id === mine.id))
          queryClient.setQueryData(messagesQueryKey(chatId), cached);
        reveal();
      })
      .catch(reveal);
  }, [chatId, currentUserId, queryClient, messages, isFocused, threadsActive, place, diskWindow]);
  const threadReplies = useChatThreadReplies({ chatId, active: threadsActive, me });
  const { announce: announceThreadReply } = threadReplies;
  const sendInView = useCallback(
    (text: string, media?: OutgoingMedia[], replies?: LiveQuote[], hidden?: HiddenRange[]) => {
      const localId = sendToChat(text, media, replies, hidden);
      if (localId) jumpAfterSend.current = localId;
      announceThreadReply(
        replies ?? [],
        { kind: media?.length ? 'media' : 'text', text, media },
        localId,
      );
    },
    [announceThreadReply, sendToChat],
  );
  const sendVoiceInView = useCallback(
    (voice: LocalMedia, replies?: LiveQuote[]) => {
      const localId = sendVoiceToChat(voice, replies);
      jumpAfterSend.current = localId;
      announceThreadReply(
        replies ?? [],
        { kind: 'voice', text: '', durationMs: voice.durationMs },
        localId,
      );
    },
    [announceThreadReply, sendVoiceToChat],
  );

  const replyForward = useReplyForward({
    chatId,
    sourceChat: thisChat,
    draft,
    authorName,
    originalOf,
    composerRef,
    send: sendInView,
    sendVoice: sendVoiceInView,
    sendPop,
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

      openComments(message.id, home.chatId, home.amMember);
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
  });

  // Системный «назад» в правке выходит из правки, а не из чата.
  // На время выбора «назад» принадлежит выбору.
  const selectionActive = selection.isActive;
  const backFromEdit = useCallback(() => void leaveEdit(), [leaveEdit]);

  useSlidePageBack(isFocused && isEditing && !selectionActive, backFromEdit);

  // Свайп страницы посреди правки: страница встаёт на место, пока правка
  // спрашивает, выходить ли.
  useSlidePageLeaveGuard(
    useCallback(
      () => (readChatDraft(chatId).mode?.type === 'edit' ? leaveEdit() : null),
      [chatId, leaveEdit],
    ),
  );

  // Страницу потянули — панель эмодзи не едет вместе с ней.
  useSlidePageSwipeStart(useCallback(() => void closeEmojiPanel('chat'), []));

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
    if (isSelecting) Keyboard.dismiss();
  }, [isSelecting]);

  useSlidePageBack(isFocused && isSelecting, clearSelection);

  const ownDirect = chat?.kind === 'direct' && isMember;
  const { bubbleFor, audienceFor, reactToComment } = useChatBubbles({
    chatId,
    currentUserId,
    isMember,
    participantsById: peopleById,
    mediaBounds,
    retry,
    openPerson,
    reactions,
    // Участнику личного диалога собеседник известен — ни аватаров, ни имён.
    // Посторонний видит диалог как группу: у каждого облачка — кто это.
    showAvatars: !isPosts && !ownDirect,
    showAuthors: !ownDirect,
    postAuthor: channel?.title ?? null,
  });

  const fragments = useFragmentMode({ isMember, isFocused, isSelecting });

  // Кнопка комментария в меню фрагмента: боковая панель кластера или области.
  const commentOnFragment = useCallback(
    (selection: TextSelection) => commentOnSelection(queryClient, selection),
    [queryClient],
  );

  const { renderItem: renderRow, islandHeader } = useChatRowRenderer({
    currentUserId,
    isMember,
    isSelecting,
    isSelected: selection.isSelected,
    toggleSelected: selection.toggle,
    editingId,
    bubbleFor,
    openMenu: menu.open,
    startReply,
    // В постах свайп листает разделы канала; ответить можно из меню.
    swipeReply: !isPosts,
    pressRow: fragments.pressRow,
    longPressAt: fragments.longPressAt,
    retry,
    hostName: authorName,
  });
  // В «Тредах» под исходным сообщением — плашка его треда.
  const { renderItem, summaries: chatThreadSummaries } = useChatThreadPlates({
    chatId,
    active: threadsActive,
    messages,
    currentUserId,
    showAvatars: !isPosts && !ownDirect,
    renderItem: renderRow,
  });

  useChatJournal(
    chatId,
    isFocused && active,
    isMember ? 'member' : subscription ? 'subscriber' : 'visitor',
  );
  const views = useMessageViews({
    chatId,
    currentUserId,
    isFocused,
    rows: presentedRows,
    autoscrollThreshold: KEEP_READING_POSITION.autoscrollToTopThreshold,
    measureRow: rowRegistry.measure,
    measureViewport: measureListFrame,
  });

  const { onViewableItemsChanged } = views;
  // Прокрутили переписку — прокрученные вбок ряды реакций возвращаются в начало.
  const { onScroll: viewsOnScroll } = views;
  const { resumeLoadMore } = chatMessages;
  const pageAllowed = useRef(true);
  const userScrolled = useRef(false);
  const motionSample = useRef({ y: 0, time: 0 });
  const requestOlder = useCallback(() => {
    if (!isFocused || !hasMore || isLoadingMore || (!threadsActive && !pageAllowed.current)) return;
    pageAllowed.current = false;
    void loadMore();
  }, [isFocused, hasMore, isLoadingMore, loadMore, threadsActive]);
  const onListDragStart = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      place.interrupt();
      pageAllowed.current = true;
      userScrolled.current = true;
      motionSample.current = { y: event.nativeEvent.contentOffset.y, time: event.timeStamp };
      resumeLoadMore(false);
      if (atHistoryEdge(event.nativeEvent, threadsActive ? HISTORY_EDGE : OLDER_PREFETCH_SCREENS))
        requestOlder();
      // Выделение привязано к месту на экране: тронули прокрутку — снимается,
      // режим фрагментов остаётся.
      clearTextSelection();
    },
    [resumeLoadMore, requestOlder, place, threadsActive],
  );

  // Где сейчас прокрутка и сколько её всего — автопрокрутке выделения: она
  // двигает список сама, кадр за кадром, не дожидаясь событий прокрутки.
  // Пока список двигает автопрокрутка, запоздавшие события прокрутки
  // везут смещение на несколько кадров старше — их смещение не берётся.
  const trackOffset = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (Date.now() - scrollState.current.drivenAt > AUTO_SCROLL_QUIET_MS) {
      scrollState.current.offset = event.nativeEvent.contentOffset.y;
    }
  }, []);

  const onListScroll = useCallback(
    (event: Parameters<typeof viewsOnScroll>[0]) => {
      const { contentOffset, layoutMeasurement } = event.nativeEvent;
      const dt = event.timeStamp - motionSample.current.time;
      const dy = contentOffset.y - motionSample.current.y;
      motionSample.current = { y: contentOffset.y, time: event.timeStamp };
      const screens =
        presentedRows.length <= 30 && dt > 0 && dt < 150 && layoutMeasurement.height > 0
          ? Math.min(
              MAX_FLING_LOOKAHEAD_SCREENS,
              Math.max(
                OLDER_PREFETCH_SCREENS,
                (dy * FLING_LOOKAHEAD_MS) / (dt * layoutMeasurement.height),
              ),
            )
          : OLDER_PREFETCH_SCREENS;
      if (
        !threadsActive &&
        userScrolled.current &&
        event.nativeEvent.contentOffset.y > scrollState.current.offset &&
        atHistoryEdge(event.nativeEvent, screens)
      )
        requestOlder();
      if (
        userScrolled.current &&
        !threadsActive &&
        event.nativeEvent.contentOffset.y < scrollState.current.offset &&
        event.nativeEvent.contentOffset.y <
          HISTORY_PREFETCH_SCREENS * event.nativeEvent.layoutMeasurement.height
      ) {
        if (diskWindow.hasNewer) diskWindow.revealNewer();
        else chatMessages.loadNewer?.();
      }
      trackOffset(event);
      if (userScrolled.current) place.moving();
      viewsOnScroll(event);
      resetScrolledRows();
    },
    [
      threadsActive,
      requestOlder,
      trackOffset,
      viewsOnScroll,
      chatMessages,
      diskWindow,
      place,
      presentedRows.length,
    ],
  );

  const onListScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      trackOffset(event);
      viewsOnScroll(event);
      // Инерция может пройти всю заранее загруженную страницу. На остановке
      // проверяем фактический край; loadMore объединяет запросы и не снимает ошибку.
      place.settled();
      if (hasMore && atHistoryEdge(event.nativeEvent)) void loadMore();
    },
    [hasMore, loadMore, trackOffset, viewsOnScroll, place],
  );

  useEffect(() => {
    if (!isFocused) return;

    return registerSelectionScroller({
      measure: async () => {
        const frame = await measureListFrame();

        return frame ? { top: frame.y, bottom: frame.y + frame.height } : null;
      },
      // Список перевёрнут: смещение растёт к старым сообщениям, то есть
      // содержимое на экране едет вниз.
      scrollBy: (delta) => {
        const state = scrollState.current;
        const max = Math.max(0, state.content - state.viewport);
        const next = Math.min(max, Math.max(0, state.offset + delta));
        const moved = next - state.offset;

        if (moved !== 0) {
          state.offset = next;
          state.drivenAt = Date.now();
          listRef.current?.scrollToOffset({ offset: next, animated: false });
        }

        return moved;
      },
    });
  }, [isFocused, measureListFrame]);

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
      selectable: isSelectableRow(menuRow, currentUserId),
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

  // Шторка треда — те же облачка, меню и отправка, что в переписке.
  const { discard, deleteMessages, removeFromIsland, saveEdit } = chatMessages;
  const chatThreadKit = useMemo(
    (): ChatThreadPanelKit => ({
      chatId,
      sourceChat: thisChat,
      currentUserId,
      isMember,
      me: me ? { id: me.userId, name: me.name ?? 'Я', avatarUrl: me.avatarUrl } : null,
      peopleById,
      showAvatars: !isPosts && !ownDirect,
      showAuthors: !ownDirect,
      reactions,
      pins,
      authorName,
      originalOf,
      openPerson,
      send: sendToChat,
      sendVoice: sendVoiceToChat,
      retry,
      discard,
      saveEdit,
      deleteMessages,
      removeFromIsland,
      notifyTyping,
      notifyRecordingVoice,
    }),
    [
      authorName,
      chatId,
      currentUserId,
      deleteMessages,
      discard,
      isMember,
      isPosts,
      me,
      notifyRecordingVoice,
      notifyTyping,
      openPerson,
      originalOf,
      ownDirect,
      peopleById,
      pins,
      reactions,
      removeFromIsland,
      retry,
      saveEdit,
      sendToChat,
      sendVoiceToChat,
      thisChat,
    ],
  );

  // Ушли из чата — его шторка треда закрывается вместе с ним.
  useEffect(
    () => () => {
      if (openedChatThread()?.chatId === chatId) closeChatThread();
    },
    [chatId],
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
            : chat?.kind === 'group'
              ? { uri: chat.avatarUrl, name: title }
              : pair && pair.length === 2
                ? [
                    { uri: pair[0].avatarUrl, name: pair[0].displayName },
                    { uri: pair[1].avatarUrl, name: pair[1].displayName },
                  ]
                : undefined
        }
        subtitle={channel ? (channelHeader?.subtitle ?? null) : chatSubtitle}
        // Группа, свой и чужой диалог — страница информации; куда ведёт
        // шапка канала, знает экран канала (`channelHeader`).
        onTitlePress={
          channel
            ? channelHeader?.onTitlePress
            : chat && chat.kind !== 'channel'
              ? () => router.push({ name: 'ChatInfo', params: { chatId } })
              : undefined
        }
        titlePressLabel={channel ? 'О канале' : 'О чате'}
        searching={chatSearch.active}
        selectedCount={selection.selected.length}
        onCancelSelection={clearSelection}
        right={
          isPosts ? (
            channelHeader?.right
          ) : isMember ? (
            <View style={styles.headerActions}>
              {chatThreads.available ? (
                <ChatThreadsToggle
                  active={threadsActive}
                  onPress={() => chatThreads.setView(threadsActive ? 'all' : 'chat-threads')}
                />
              ) : null}
              {/* В заявку не звонят — это решает и база. */}
              {chat?.requestPending ? null : (
                <CallButton
                  live={call.stream !== null}
                  disabled={call.busy}
                  onPress={call.startOrJoin}
                />
              )}
              <ChatMenu chatId={chatId} isMember subscription={null} />
            </View>
          ) : chat && !gone ? (
            <View style={styles.headerActions}>
              {chatThreads.available ? (
                <ChatThreadsToggle
                  active={threadsActive}
                  onPress={() => chatThreads.setView(threadsActive ? 'all' : 'chat-threads')}
                />
              ) : null}
              <ChatMenu chatId={chatId} isMember={false} subscription={subscription} />
            </View>
          ) : undefined
        }
      />

      {chatSearch.active ? <ChatSearchHeader search={chatSearch} onClose={leaveSearch} /> : null}

      <Animated.View testID="chat-keyboard-area" style={[styles.flex, keyboardInsetStyle]}>
        {/* Звонок срочнее закрепа: он идёт прямо сейчас. */}
        <ChatCallBar
          stream={call.stream}
          isInThisCall={call.isInThisCall}
          isMember={isMember}
          onPress={call.openBar}
        />

        <PinnedBar pins={pins.pins} index={pinCursor.index} onPress={pinCursor.advance} />

        {requestSent ? null : <WaitingBanner waiting={waitingForOthers} />}

        {gone ? (
          <View testID="chat-gone" style={styles.centered}>
            <Text color="textSecondary">Чат удалён</Text>
          </View>
        ) : failed ? (
          <LoadFailed message="Не удалось загрузить переписку" onRetry={reload} />
        ) : (isChatLoading || isLoading) && messages.length === 0 ? (
          <View style={styles.centered}>
            <ActivityIndicator accessibilityLabel="Загрузка переписки" />
          </View>
        ) : (
          <Animated.View ref={listFrameRef} style={[styles.flex, place.hidden && { opacity: 0 }]}>
            <HistoryLayouts.Provider value={place.layouts}>
              <RowRegistryContext.Provider value={rowRegistry}>
                <TileViewportContext.Provider value={measureListFrame}>
                  <FlatList
                    // Другой вид — другая лента: список начинается заново, а не
                    // со смещения прежней.
                    key={chatThreads.view}
                    showsVerticalScrollIndicator={false}
                    showsHorizontalScrollIndicator={false}
                    ref={listRef}
                    testID="messages-list"
                    inverted
                    scrollEnabled={!place.hidden}
                    data={presentedRows}
                    CellRendererComponent={HistoryCell}
                    initialNumToRender={20}
                    // Разметить несколько ближайших облачков до следующего взмаха:
                    // одна пачка из десяти строк с медиа может занять весь жест.
                    maxToRenderPerBatch={4}
                    updateCellsBatchingPeriod={16}
                    onScrollToIndexFailed={({ averageItemLength, index }) =>
                      listRef.current?.scrollToOffset({
                        offset: averageItemLength * index,
                        animated: false,
                      })
                    }
                    keyExtractor={rowRenderKey}
                    renderItem={renderItem}
                    // Плашки тредов приходят после строк: видимые ячейки перерисовываются.
                    extraData={chatThreadSummaries}
                    viewabilityConfig={views.viewabilityConfig}
                    onViewableItemsChanged={onViewableItemsChanged}
                    onScroll={onListScroll}
                    onScrollBeginDrag={onListDragStart}
                    onScrollEndDrag={onListScrollEnd}
                    onMomentumScrollEnd={onListScrollEnd}
                    onContentSizeChange={(_width, height) => {
                      scrollState.current.content = height;
                      place.layoutChanged();
                    }}
                    onLayout={(event) => {
                      scrollState.current.viewport = event.nativeEvent.layout.height;
                      place.layoutChanged();
                    }}
                    scrollEventThrottle={LIST_SCROLL_THROTTLE_MS}
                    contentContainerStyle={styles.list}
                    // The list is inverted, so its "end" is the top of the screen:
                    // scrolling up pages further back through the history.
                    // Облачко ниже экрана выросло или сжалось (правка, подгрузка
                    // картинки) — то, что человек читает выше, остаётся на месте.
                    // У самого низа переписки список по-прежнему едет за новым.
                    maintainVisibleContentPosition={KEEP_READING_POSITION}
                    onEndReached={hasMore && !place.hidden ? requestOlder : undefined}
                    onEndReachedThreshold={threadsActive ? HISTORY_EDGE : OLDER_PREFETCH_SCREENS}
                    // Тап по облачку при открытой клавиатуре сразу открывает меню, а
                    // не только прячет клавиатуру; тап по пустому месту — прячет.
                    keyboardShouldPersistTaps="handled"
                    ListFooterComponent={
                      isLoadingMore ? (
                        <ActivityIndicator accessibilityLabel="Загрузка истории" />
                      ) : null
                    }
                  />
                </TileViewportContext.Provider>
              </RowRegistryContext.Provider>
            </HistoryLayouts.Provider>
          </Animated.View>
        )}

        {showSearchList ? <ChatSearchResults search={chatSearch} /> : null}

        {!gone && !failed && !isChatLoading && !isLoading && messages.length === 0 ? (
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

        {chatSearch.active ? (
          <ChatSearchPlate
            search={chatSearch}
            showingList={showSearchList}
            onToggleList={() => setSearchListShown((shown) => !shown)}
          />
        ) : (
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
              !gone &&
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
            requestSent={requestSent}
            // Постороннему писать некуда: поле ввода не показывается вовсе. Пока
            // чат грузится, оно смонтировано с надписью вместо поля (`canSend`
            // ложно): смонтированное заранее, оно встаёт над клавиатурой вовремя.
            // Переписка не загрузилась — писать некуда, пока она не откроется.
            composer={
              failed || gone || requestSent || (!isMember && (isPosts || chat !== null))
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
                    // Экран ушёл под другой — панель эмодзи закрывается вместе с ним.
                    screenFocused: isFocused,
                    pop: isEditing ? null : popChip,
                    // Скрывать от зрителей в посте канала некому: его читают все.
                    hidden: isPosts
                      ? undefined
                      : { ranges: draft.hidden, onChange: draft.setHidden },
                  }
            }
          />
        )}
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

      <FragmentMenu measureViewport={measureListFrame} onComment={commentOnFragment} />

      <MessageContextMenu
        anchor={menu.target?.anchor ?? null}
        viewport={menu.target?.viewport ?? null}
        preview={menuPreview}
        actions={menuActions}
        reactions={menuReactions}
        onAction={runMenuAction}
        onClose={menu.close}
        journalSubject={menuContent ? { type: 'message', id: menuContent.id } : null}
      />

      {isFocused ? <ChatThreadPanel kit={chatThreadKit} /> : null}

      <CommentsPanel onOpenPerson={openPerson} hostChatId={chatId} />
    </View>
  );
}
