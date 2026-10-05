import type { FlashListRef, ListRenderItem } from '@shopify/flash-list';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, useWindowDimensions, type TextInput } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { KeyboardEvents } from 'react-native-keyboard-controller';
import Animated from 'react-native-reanimated';

import { CommentList } from './CommentList';
import { CommentRowView } from './CommentRowView';
import { CommentTargetView } from './CommentTargetView';
import { PanelFooter } from './PanelFooter';
import { PanelHeader } from './PanelHeader';
import type { CommentRow } from './rows';
import { SheetHeader } from './SheetHeader';
import { CommentsSheetContext, type CommentsSheetContextValue } from './SheetList';
import { styles } from './styles';
import { ThreadGapRow } from './ThreadGapRow';
import { usePanelActions } from './usePanelActions';
import { usePanelComments } from './usePanelComments';
import type { PanelSheet } from './usePanelSheet';
import { useStickyThread } from './useStickyThread';

import { mosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { MessageBubble } from '@/features/chats/MessageBubble';
import { canReactTo } from '@/features/chats/messageActions';
import { MessageContextMenu } from '@/features/chats/MessageContextMenu';
import { DELETED_ACCOUNT } from '@/features/chats/messageQuote';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { visibleQuotes, type CommentItem } from '@/features/interactions/comments/commentItem';
import { commentsCountLabel } from '@/features/interactions/comments/commentsCount';
import type { CommentsPanelTarget } from '@/features/interactions/comments/commentsPanelStore';
import { useJumpToComment } from '@/features/interactions/comments/useJumpToComment';
import { audienceOf } from '@/features/interactions/reactionState';
import { showNotice } from '@/features/notifications/alertsStore';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing } from '@/theme';

/** Облачко чужого начинается после аватара и зазора (`MessageBubble`). */
const BUBBLE_LEADING_INSET = Spacing.five + Spacing.two;
const MEMBER_BADGE = 'участник чата';
/** Дольше этого не ждём сообщение сверху: шит выезжает с заглушкой. */
const TARGET_WAIT_MS = 1000;
const noop = () => undefined;

export type PanelContentProps = {
  target: CommentsPanelTarget;
  sheet: PanelSheet;
  onOpenPerson: (userId: string) => void;
  /** Чат экрана под панелью — см. `CommentsPanelProps`. */
  hostChatId?: string;
  /** «Назад» сначала спрашивает содержимое: правка и выбор выходят первыми. */
  backRef: { current: () => boolean };
};

/** Всё, что внутри панели: сообщение сверху, комментарии с тредами, поле ввода и меню. */
export function PanelContent({
  target,
  sheet,
  onOpenPerson,
  hostChatId,
  backRef,
}: PanelContentProps) {
  const theme = useTheme();
  const currentUserId = useCurrentUserId();
  const { width } = useWindowDimensions();
  const mediaBounds = useMemo(() => mosaicBounds(width - Spacing.three * 2), [width]);
  const replyBounds = useMemo(
    () => mosaicBounds(width - Spacing.three * 2 - Sizes.threadIndent),
    [width],
  );
  const data = usePanelComments(target, currentUserId);
  const { about, live, amMember, comments, openThread, thread, rows } = data;
  const listRef = sheet.listRef as unknown as React.RefObject<FlashListRef<CommentRow> | null>;
  const inputRef = useRef<TextInput>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const closed = about?.state === 'deleted' || about?.state === 'missing';
  const { geometry, headerHeight, scrollOffset, close, closeNow, expand, markReady } = sheet;

  const sticky = useStickyThread({
    listRef,
    rows,
    openThread,
    scrollOffset,
    travel: geometry.travel,
    headerHeight,
  });

  const jumpSource = useMemo(
    () => ({
      keys: rows.map((row) => row.key),
      hasMore: openThread ? thread.hasGap : comments.hasMore,
      loadMore: openThread ? thread.loadMore : comments.loadMore,
    }),
    [comments.hasMore, comments.loadMore, openThread, rows, thread],
  );
  const { jump, highlight } = useJumpToComment(listRef, jumpSource);

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
    inputRef,
    listRef,
    sheet,
    stickyCollapse: sticky.prepareCollapse,
    stickySwitch: sticky.prepareSwitch,
    jump,
  });

  useEffect(() => {
    backRef.current = actions.back;
  }, [actions.back, backRef]);

  // Шит выезжает, когда шапка замерена с настоящим сообщением: положения
  // считаются по её высоте. Сообщение не пришло за секунду — выезжаем так.
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), TARGET_WAIT_MS);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (headerHeight > 0 && (about !== undefined || waited)) markReady();
  }, [about, headerHeight, markReady, waited]);

  // Пришли к комментарию — он вспыхивает, когда встал в список. Виден и так —
  // шит не двигается: над ним в переписке стоит сообщение этого комментария.
  const { focusReady } = data;
  const visibleListHeight = useRef(0);

  useEffect(() => {
    visibleListHeight.current = geometry.listHeight - composerHeight - keyboardInset;
  }, [composerHeight, geometry.listHeight, keyboardInset]);

  useEffect(() => {
    if (!focusReady) return;

    const visibleBottom = () => scrollOffset.value + visibleListHeight.current;

    void jump(focusReady, { visibleBottom }).then((found) => {
      if (!found) showNotice('Не удалось найти комментарий', 'error');
    });
  }, [focusReady, jump, scrollOffset]);

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

  const { retry, react } = comments;
  const myAudience = audienceOf(amMember);
  const renderBubble = useCallback(
    (item: CommentItem, aside: ReactNode = null, interactive = true) => {
      const { authorId } = item;
      const quotes = visibleQuotes(item);

      return (
        <MessageBubble
          message={quotes === item.replies ? item : { ...item, replies: quotes }}
          isOwn={authorId !== null && authorId === currentUserId}
          isRead={false}
          showReceipt={false}
          authorName={item.authorName ?? DELETED_ACCOUNT}
          authorAvatarUrl={item.authorAvatarUrl}
          authorBadge={item.audience === 'member' ? MEMBER_BADGE : null}
          mediaBounds={item.threadRootId ? replyBounds : mediaBounds}
          onRetry={retry}
          onAuthorPress={interactive && authorId ? () => openPerson(authorId) : undefined}
          onQuotePress={interactive ? (quote) => void actions.jumpToQuote(quote.messageId) : undefined}
          reactionAudience={myAudience}
          onReactionToggle={
            interactive && canReactTo(item) ? (emoji) => react(item, emoji) : undefined
          }
          aside={aside}
        />
      );
    },
    [actions, currentUserId, mediaBounds, myAudience, openPerson, react, replyBounds, retry],
  );

  const { selection } = actions;
  const editingId = actions.edit.mode?.message.id ?? null;

  const renderComment = useCallback(
    (row: Extract<CommentRow, { type: 'comment' }>) => (
      <CommentRowView
        comment={row.comment}
        thread={row.thread}
        replies={row.replies}
        selectionMode={selection.isActive}
        selected={selection.isSelected(row.comment.id)}
        editing={row.comment.id === editingId}
        highlightKey={highlight?.id === row.comment.id ? highlight.key : null}
        threadOpen={openThread === row.comment.id}
        onOpenMenu={actions.openMenu}
        onSelect={actions.selectOne}
        onToggle={actions.toggleSelected}
        onSwipeReply={closed ? undefined : actions.replyTo}
        onToggleThread={actions.toggleThread}
        renderBubble={renderBubble}
      />
    ),
    [actions, closed, editingId, highlight, openThread, renderBubble, selection],
  );

  const renderRow = useCallback<ListRenderItem<CommentRow>>(
    ({ item }) =>
      item.type === 'comment' ? (
        renderComment(item)
      ) : (
        <ThreadGapRow
          thread={item.thread}
          hidden={item.type === 'thread-gap' ? item.hidden : null}
          isLoading={item.type === 'thread-gap' && thread.isLoadingMore}
          onPress={() => void thread.loadMore()}
        />
      ),
    [renderComment, thread],
  );

  const targetAuthorId = live?.message.authorId ?? null;
  const targetBubble = live ? (
    <MessageBubble
      message={{ ...live.message, status: 'sent' }}
      isOwn={targetAuthorId !== null && targetAuthorId === currentUserId}
      isRead={false}
      showReceipt={false}
      authorName={live.authorName ?? DELETED_ACCOUNT}
      authorAvatarUrl={live.authorAvatarUrl}
      mediaBounds={mediaBounds}
      onRetry={noop}
      onAuthorPress={targetAuthorId ? () => openPerson(targetAuthorId) : undefined}
    />
  ) : null;

  const count = live?.message.commentsCount ?? 0;
  const stickyRoot = sticky.rootRow?.type === 'comment' ? sticky.rootRow : null;

  const overlay = (
    <>
      {stickyRoot ? (
        <Animated.View
          testID="sticky-thread-root"
          pointerEvents={sticky.stuck ? 'box-none' : 'none'}
          // Непрозрачная подложка: под копией листаются ответы, а фон треда
          // поверх неё полупрозрачный.
          style={[styles.stickyRoot, { backgroundColor: theme.background }, sticky.style]}
        >
          {renderComment(stickyRoot)}
        </Animated.View>
      ) : null}
    </>
  );

  const sheetContext: CommentsSheetContextValue = {
    travel: geometry.travel,
    animatedRef: sheet.animatedRef,
    gestureRef: sheet.scrollGestureRef,
    scrollOffset,
    dismissing: sheet.dismissing,
    onScrollAttached: sheet.markScrollAttached,
    overlay,
  };

  return (
    <>
      <Animated.View style={[styles.fill, sheet.shiftStyle]} pointerEvents="box-none">
        <GestureDetector gesture={sheet.dismissPan}>
          <View style={[styles.listWindow, { top: geometry.top }]}>
            <CommentsSheetContext.Provider value={sheetContext}>
              <CommentList
                listRef={listRef}
                rows={rows}
                isLoading={comments.isLoading}
                isLoadingMore={comments.isLoadingMore}
                hasMore={comments.hasMore}
                error={comments.error}
                closed={closed}
                loadMore={comments.loadMore}
                headerSpace={geometry.travel + headerHeight}
                footerSpace={composerHeight + keyboardInset}
                minContentHeight={geometry.travel + geometry.listHeight}
                renderRow={renderRow}
                extraData={actions.extraData}
                onCommitLayout={sticky.onCommitLayout}
              />
            </CommentsSheetContext.Provider>
            <SheetHeader
              travel={geometry.travel}
              scrollOffset={scrollOffset}
              onHeight={sheet.setHeaderHeight}
              pan={sheet.headerPan}
            >
              <PanelHeader
                title={count > 0 ? commentsCountLabel(count) : 'Комментарии'}
                onClose={closeNow}
              />
              <CommentTargetView target={about} bubble={targetBubble} />
            </SheetHeader>
          </View>
        </GestureDetector>
      </Animated.View>

      <PanelFooter
        style={sheet.footerStyle}
        onHeight={setComposerHeight}
        actions={actions}
        closed={closed}
        onFieldActivate={expand}
      />

      <MessageContextMenu
        anchor={actions.menuAnchor}
        preview={actions.menuComment ? renderBubble(actions.menuComment, null, false) : null}
        actions={actions.menuActions}
        reactions={actions.menuReactions}
        alignEnd={actions.menuComment?.authorId === currentUserId}
        leadingInset={BUBBLE_LEADING_INSET}
        onAction={actions.runMenuAction}
        onClose={actions.closeMenu}
      />
    </>
  );
}
