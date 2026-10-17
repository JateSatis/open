import type { FlashListRef, ListRenderItem } from '@shopify/flash-list';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, useWindowDimensions, type TextInput } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { KeyboardEvents } from 'react-native-keyboard-controller';
import Animated, { type SharedValue } from 'react-native-reanimated';

import type { CommentHighlight } from './CommentList';
import { CommentRowView } from './CommentRowView';
import { PaneList } from './PaneList';
import { PanelFooter } from './PanelFooter';
import { PanelHeader } from './PanelHeader';
import type { CommentRow } from './rows';
import { SheetHeader } from './SheetHeader';
import { styles } from './styles';
import { ThreadGapRow } from './ThreadGapRow';
import { usePanelActions } from './usePanelActions';
import { usePanelComments } from './usePanelComments';
import type { PanelSheet } from './usePanelSheet';
import { useGoToFragment } from './useGoToFragment';
import { useThreadPane } from './useThreadPane';

import { FragmentQuote } from '@/features/chats/FragmentQuote';
import { mosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { MessageBubble } from '@/features/chats/MessageBubble';
import { TileViewportContext } from '@/features/media/tileRegistry';
import { canReactTo } from '@/features/chats/messageActions';
import { MessageContextMenu } from '@/features/chats/MessageContextMenu';
import { measureInWindow } from '@/features/chats/rowRegistry';
import { DELETED_ACCOUNT } from '@/features/chats/messageQuote';
import { useChatTitle } from '@/features/chats/useChatTitle';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { visibleQuotes, type CommentItem } from '@/features/interactions/comments/commentItem';
import { commentsCountLabel } from '@/features/interactions/comments/commentsCount';
import {
  getOpenThread,
  setOpenThread,
  useOpenThread,
  type CommentsPanelTarget,
} from '@/features/interactions/comments/commentsPanelStore';
import { useJumpToComment } from '@/features/interactions/comments/useJumpToComment';
import { audienceOf } from '@/features/interactions/reactionState';
import { showNotice } from '@/features/notifications/alertsStore';
import { useTheme } from '@/hooks/use-theme';
import { focusWithKeyboard } from '@/lib/windowFocus';
import { Spacing } from '@/theme';

/** Метка у имени автора-участника: у сообщения — участник чата, у попа — публикующий в канале. */
const MEMBER_BADGE = { message: 'участник чата', pop: 'Автор' } as const;

const CLOSED_NOTICE = {
  message: 'Сообщение удалено — новые комментарии не принимаются.',
  pop: 'Поп удалён — новые комментарии не принимаются.',
} as const;

const exitThread = () => setOpenThread(null);
const noop = () => undefined;

type ListRef = React.RefObject<FlashListRef<CommentRow> | null>;

export type PanelContentProps = {
  target: CommentsPanelTarget;
  sheet: PanelSheet;
  onOpenPerson: (userId: string) => void;
  /** Чат экрана под панелью — см. `CommentsPanelProps`. */
  hostChatId?: string;
  /** «Назад» сначала спрашивает содержимое: правка, выбор и окно треда выходят первыми. */
  backRef: { current: () => boolean };
  /** Ширина окна панели; нет — во весь экран (шит). Боковая панель уже экрана. */
  width?: number;
  /**
   * Своя шапка: заголовок и блок под ним (цитата и реакции фрагмента). В
   * окне треда — обычная «Ответы».
   */
  header?: { title: string; extra: ReactNode };
  /** Поле ввода получает фокус, как только станет `true` (панель доехала). */
  focusInput?: boolean;
};

/**
 * Всё, что внутри шита: заголовок, основной список комментариев, окно треда
 * поверх него, поле ввода и меню.
 *
 * Списков два, и оба смонтированы всё время: основной под окном треда не
 * теряет прокрутку и не строится заново. У каждого свой жест закрытия и своя
 * позиция скролла (`usePanelSheet`), так что шит тянет тот, что на экране.
 */
export function PanelContent({
  target,
  sheet,
  onOpenPerson,
  hostChatId,
  backRef,
  width: panelWidth,
  header,
  focusInput = false,
}: PanelContentProps) {
  const theme = useTheme();
  const currentUserId = useCurrentUserId();
  const { width: windowWidth } = useWindowDimensions();
  const width = panelWidth ?? windowWidth;
  const mediaBounds = useMemo(() => mosaicBounds(width - Spacing.three * 2), [width]);
  const openThread = useOpenThread();
  const threadPane = useThreadPane({ openThread, width, onExit: exitThread });
  const data = usePanelComments(target, currentUserId, threadPane.shownRoot);
  const { about, live, pop, amMember, comments, thread, rows, threadRows } = data;
  const targetType = target.subject.type;
  const memberBadge = MEMBER_BADGE[targetType];
  const chatTitleText = useChatTitle(targetType === 'message' ? target.chatId : undefined);
  const mediaTitle = targetType === 'pop' ? (pop?.channelTitle ?? '') : chatTitleText;
  const listRef = sheet.main.listRef as unknown as ListRef;
  const threadListRef = sheet.thread.listRef as unknown as ListRef;
  const inputRef = useRef<TextInput>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const closed = about?.state === 'deleted' || about?.state === 'missing';
  const { geometry, headerHeight, close } = sheet;
  const sheetLayout = useRef({ headerHeight: 0, visibleHeight: 0 });
  const listWindowRef = useRef<View>(null);
  // Видимая часть списка: под заголовком шита и над полем ввода. Копия
  // облачка под меню рисуется только в ней — как и само облачко.
  const measureViewport = useCallback(async () => {
    const frame = await measureInWindow(listWindowRef.current);

    if (!frame) return null;

    const { headerHeight: header, visibleHeight } = sheetLayout.current;

    return { ...frame, y: frame.y + header, height: Math.max(0, visibleHeight - header) };
  }, []);

  const mainJump = useJumpToComment(
    listRef,
    useMemo(
      () => ({
        keys: rows.map((row) => row.key),
        hasMore: comments.hasMore,
        loadMore: comments.loadMore,
      }),
      [comments.hasMore, comments.loadMore, rows],
    ),
  );
  const threadJump = useJumpToComment(
    threadListRef,
    useMemo(
      () => ({
        keys: threadRows.map((row) => row.key),
        hasMore: thread.hasGap,
        loadMore: thread.loadMore,
      }),
      [thread.hasGap, thread.loadMore, threadRows],
    ),
  );

  const openPerson = useCallback(
    (userId: string) => {
      close();
      onOpenPerson(userId);
    },
    [close, onOpenPerson],
  );

  const actions = usePanelActions({
    target,
    hostChatId,
    live,
    data,
    currentUserId,
    openThread: openThread?.rootId ?? null,
    inputRef,
    listRef,
    threadListRef,
    sheet,
    jump: threadJump.jump,
    measureViewport,
  });

  useEffect(() => {
    backRef.current = actions.back;
  }, [actions.back, backRef]);

  useEffect(() => {
    if (focusInput) focusWithKeyboard(inputRef, undefined, true);
  }, [focusInput]);

  // Пришли к комментарию — он вспыхивает, когда встал в список: ответ — в
  // окне своего треда, верхнеуровневый — в основном. Список к нему не
  // двигается: он и так наверху.
  const { focusReady } = data;

  useEffect(() => {
    sheetLayout.current = {
      headerHeight,
      visibleHeight: geometry.height - composerHeight - keyboardInset,
    };
  }, [composerHeight, geometry.height, headerHeight, keyboardInset]);

  // Окно треда — один список на все треды: новый тред начинается сверху, и
  // жест закрытия не опирается на прокрутку прежнего.
  const enteredRoot = openThread?.rootId ?? null;
  const { scrollToTop: threadToTop } = sheet.thread;

  useEffect(() => {
    if (enteredRoot) threadToTop();
  }, [enteredRoot, threadToTop]);

  const { jump: jumpMain } = mainJump;
  const { jump: jumpThread } = threadJump;
  const mainOffset = sheet.main.scrollOffset;
  const threadOffset = sheet.thread.scrollOffset;

  // В окне треда — когда легло начало треда: до того ответ стоит в хвосте, а
  // потом переезжает на своё место, и прыжок пришёлся бы мимо.
  const threadSettling = openThread !== null && thread.isLoading && !thread.failed;
  const jumpedTo = useRef<string | null>(null);

  useEffect(() => {
    if (!focusReady || threadSettling || jumpedTo.current === focusReady) return;

    jumpedTo.current = focusReady;

    const inThread = getOpenThread() !== null;
    const offset: SharedValue<number> = inThread ? threadOffset : mainOffset;
    // Видно — между низом шапки шита и полем ввода.
    const visible = () => {
      const { headerHeight: header, visibleHeight } = sheetLayout.current;

      return { top: offset.value + header, bottom: offset.value + visibleHeight };
    };

    void (inThread ? jumpThread : jumpMain)(focusReady, { visible }).then((found) => {
      if (!found) showNotice('Не удалось найти комментарий', 'error');
    });
  }, [focusReady, jumpMain, jumpThread, mainOffset, threadOffset, threadSettling]);

  // Место под клавиатурой в конце списка: последний комментарий виден над ней.
  useEffect(() => {
    const shown = KeyboardEvents.addListener('keyboardDidShow', (event) =>
      setKeyboardInset(event.height),
    );
    const hidden = KeyboardEvents.addListener('keyboardDidHide', () => setKeyboardInset(0));

    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  const goToFragment = useGoToFragment(target, live?.message ?? null, close, hostChatId);
  const { retry, react } = comments;
  const myAudience = audienceOf(amMember);
  const renderBubble = useCallback(
    (item: CommentItem, interactive = true) => {
      const { authorId, fragmentId, fragmentQuote } = item;
      const quotes = visibleQuotes(item);
      const isOwn = authorId !== null && authorId === currentUserId;

      return (
        <MessageBubble
          message={quotes === item.replies ? item : { ...item, replies: quotes }}
          isOwn={isOwn}
          lead={
            // У заглушки удалённого корня содержимого нет — и цитаты тоже.
            !item.deleted && (fragmentId || fragmentQuote) ? (
              <FragmentQuote
                text={fragmentQuote?.text ?? null}
                isOwn={isOwn}
                // Своё неотправленное ещё не знает фрагмента — переходить не к чему.
                onPress={interactive && fragmentId ? () => void goToFragment(item) : undefined}
              />
            ) : undefined
          }
          isRead={false}
          // Галочки у комментария ничего не значат: прочтений у него нет.
          receipts={false}
          showViews={false}
          authorName={item.authorName ?? DELETED_ACCOUNT}
          authorAvatarUrl={item.authorAvatarUrl}
          authorBadge={item.audience === 'member' ? memberBadge : null}
          mediaBounds={mediaBounds}
          onRetry={interactive ? retry : undefined}
          onAuthorPress={interactive && authorId ? () => openPerson(authorId) : undefined}
          onQuotePress={
            interactive ? (quote) => void actions.jumpToQuote(quote.messageId) : undefined
          }
          reactionAudience={myAudience}
          onReactionToggle={
            interactive && canReactTo(item) ? (emoji) => react(item, emoji) : undefined
          }
          // У комментария один общий ряд: участники и зрители вместе, тапает любой.
          reactionsLayout="merged"
        />
      );
    },
    [
      actions,
      currentUserId,
      goToFragment,
      mediaBounds,
      memberBadge,
      myAudience,
      openPerson,
      react,
      retry,
    ],
  );

  const { selection } = actions;
  const editingId = actions.edit.mode?.message.id ?? null;

  const rowRenderer = useCallback(
    (highlight: CommentHighlight | null): ListRenderItem<CommentRow> =>
      function renderRow({ item }) {
        if (item.type !== 'comment') {
          return (
            <ThreadGapRow
              hidden={item.type === 'thread-gap' ? item.hidden : null}
              isLoading={item.type === 'thread-gap' && thread.isLoadingMore}
              failed={item.type === 'thread-failed'}
              onPress={item.type === 'thread-failed' ? thread.retry : () => void thread.loadMore()}
            />
          );
        }

        const { comment } = item;

        return (
          <CommentRowView
            comment={comment}
            threadRoot={item.threadRoot}
            replies={item.replies}
            pinned={item.pinned}
            isOwn={comment.authorId !== null && comment.authorId === currentUserId}
            selectionMode={selection.isActive}
            selected={selection.isSelected(comment.id)}
            editing={comment.id === editingId}
            highlightKey={highlight?.id === comment.id ? highlight.key : null}
            onOpenMenu={actions.openMenu}
            onToggle={actions.toggleSelected}
            onSwipeReply={closed ? undefined : actions.replyTo}
            onOpenThread={actions.openThread}
            renderBubble={renderBubble}
          />
        );
      },
    [actions, closed, currentUserId, editingId, renderBubble, selection, thread],
  );

  const renderMainRow = useMemo(
    () => rowRenderer(mainJump.highlight),
    [mainJump.highlight, rowRenderer],
  );
  const renderThreadRow = useMemo(
    () => rowRenderer(threadJump.highlight),
    [rowRenderer, threadJump.highlight],
  );

  const count = live?.message.commentsCount ?? pop?.commentsCount ?? 0;
  const inThread = openThread !== null;
  const listProps = {
    closed,
    headerSpace: headerHeight,
    footerSpace: composerHeight + keyboardInset,
    extraData: actions.extraData,
    dismissing: sheet.dismissing,
  };

  return (
    // Медиа в облачках панели улетает в свою плитку, только если та видна в
    // этой же части списка.
    <TileViewportContext.Provider value={measureViewport}>
      <Animated.View style={[styles.fill, sheet.shiftStyle]} pointerEvents="box-none">
        <View
          ref={listWindowRef}
          style={[
            styles.listWindow,
            { top: geometry.top, backgroundColor: theme.background, borderColor: theme.border },
          ]}
        >
          <Animated.View
            style={[styles.fill, threadPane.underlayStyle]}
            pointerEvents={inThread ? 'none' : 'auto'}
          >
            <PaneList
              {...listProps}
              testID="comments-list"
              pane={sheet.main}
              listRef={listRef}
              rows={rows}
              isLoading={comments.isLoading}
              isLoadingMore={comments.isLoadingMore}
              hasMore={comments.hasMore}
              error={comments.error}
              loadMore={comments.loadMore}
              renderRow={renderMainRow}
            />
          </Animated.View>

          <GestureDetector gesture={threadPane.edgePan}>
            <Animated.View
              testID="comments-thread"
              style={[
                styles.threadPane,
                { backgroundColor: theme.background },
                threadPane.paneStyle,
              ]}
              pointerEvents={inThread ? 'auto' : 'none'}
            >
              <PaneList
                {...listProps}
                testID="comments-thread-list"
                pane={sheet.thread}
                listRef={threadListRef}
                rows={threadRows}
                silentWhenEmpty
                isLoading={false}
                isLoadingMore={false}
                hasMore={false}
                error={null}
                loadMore={noop}
                renderRow={renderThreadRow}
              />
            </Animated.View>
          </GestureDetector>

          <SheetHeader onHeight={sheet.setHeaderHeight} pan={sheet.headerPan}>
            <PanelHeader
              title={
                inThread
                  ? 'Ответы'
                  : (header?.title ?? (count > 0 ? commentsCountLabel(count) : 'Комментарии'))
              }
              onBack={inThread ? exitThread : undefined}
              // Своя шапка — у боковой панели: её не тянут вниз.
              grabber={!header}
            />
            {header && !inThread ? header.extra : null}
          </SheetHeader>
        </View>
      </Animated.View>

      <PanelFooter
        style={sheet.footerStyle}
        onHeight={setComposerHeight}
        actions={actions}
        closedNotice={closed ? CLOSED_NOTICE[targetType] : null}
        placeholder={inThread ? 'Ответить в треде' : 'Комментарий'}
        title={mediaTitle}
      />

      <MessageContextMenu
        anchor={actions.menuAnchor}
        viewport={actions.menuViewport}
        preview={actions.menuComment ? renderBubble(actions.menuComment, false) : null}
        actions={actions.menuActions}
        reactions={actions.menuReactions}
        onAction={actions.runMenuAction}
        onClose={actions.closeMenu}
      />
    </TileViewportContext.Provider>
  );
}
