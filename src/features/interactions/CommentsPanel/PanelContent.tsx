import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type MutableRefObject,
} from 'react';
import { View, useWindowDimensions, type FlatList, type TextInput } from 'react-native';
import { GestureDetector, type PanGesture } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';

import { CommentComposer } from './CommentComposer';
import { CommentList } from './CommentList';
import { CommentTargetView } from './CommentTargetView';
import { PanelHeader } from './PanelHeader';
import { styles } from './styles';

import { mosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { MessageBubble } from '@/features/chats/MessageBubble';
import { MessageContextMenu } from '@/features/chats/MessageContextMenu';
import { DELETED_ACCOUNT } from '@/features/chats/messageQuote';
import type { ChatMessage, EditResult } from '@/features/chats/messages/types';
import { useComposerDraft } from '@/features/chats/useComposerDraft';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { useMessageEdit } from '@/features/chats/useMessageEdit';
import { useMessageMenu } from '@/features/chats/useMessageMenu';
import { visibleCommentActions } from '@/features/interactions/comments/commentActions';
import { commentThreadKey, type CommentItem } from '@/features/interactions/comments/commentItem';
import type { CommentsPanelTarget } from '@/features/interactions/comments/commentsPanelStore';
import { commentsCountLabel } from '@/features/interactions/comments/commentsCount';
import { useCommentActionHandlers } from '@/features/interactions/comments/useCommentActionHandlers';
import { useComments } from '@/features/interactions/comments/useComments';
import { useCommentTarget } from '@/features/interactions/comments/useCommentTarget';
import type { LocalMedia } from '@/features/media';
import { Spacing } from '@/theme';

/** Облачко чужого начинается после аватара и зазора (`MessageBubble`). */
const BUBBLE_LEADING_INSET = Spacing.five + Spacing.two;
const MEMBER_BADGE = 'участник чата';
const noop = () => undefined;
const commentKey = (comment: CommentItem) => comment.id;

export type PanelContentProps = {
  target: CommentsPanelTarget;
  /**
   * Жест шита — фабрикой: тянут и за шапку, и за исходное сообщение, а один
   * объект жеста нельзя отдать двум детекторам.
   */
  makeDragGesture: () => PanGesture;
  /** Потолок высоты исходного сообщения — от места, что осталось в шите. */
  targetStyle: ComponentProps<typeof Animated.View>['style'];
  /** Низ исходного сообщения от верха шита — по нему шит встаёт в половину. */
  onRegionLayout: (bottom: number) => void;
  onHeaderLayout: (height: number) => void;
  onComposerLayout: (height: number) => void;
  /** Касание поля ввода: шит разворачивается. */
  onFieldActivate: () => void;
  onClose: () => void;
  onOpenPerson: (userId: string) => void;
  /** «Назад» сначала спрашивает содержимое: идущая правка выходит из правки, а не из панели. */
  backRef: MutableRefObject<() => boolean>;
};

/** Всё, что внутри панели: сообщение сверху, комментарии, поле ввода и меню. */
export function PanelContent({
  target,
  makeDragGesture,
  targetStyle,
  onRegionLayout,
  onHeaderLayout,
  onComposerLayout,
  onFieldActivate,
  onClose,
  onOpenPerson,
  backRef,
}: PanelContentProps) {
  const { messageId } = target;
  const currentUserId = useCurrentUserId();
  const { width } = useWindowDimensions();
  const mediaBounds = useMemo(() => mosaicBounds(width - Spacing.three * 2), [width]);
  const { data: about } = useCommentTarget(messageId, target.chatId);
  const live = about?.state === 'live' ? about : null;
  const thread = useComments(messageId, live?.message.chatId ?? target.chatId ?? '', currentUserId);
  const draft = useComposerDraft(commentThreadKey(messageId));
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<CommentItem>>(null);
  const menu = useMessageMenu<CommentItem>(commentKey);
  // Раскрытое сообщение листается само — тянуть шит за него нельзя.
  const [targetExpanded, setTargetExpanded] = useState(false);
  const headerGesture = useMemo(() => makeDragGesture(), [makeDragGesture]);
  const targetGesture = useMemo(
    () => makeDragGesture().enabled(!targetExpanded),
    [makeDragGesture, targetExpanded],
  );

  const { saveEdit: saveCommentEdit } = thread;
  // Правка — общая с сообщениями: поле знает только `ChatMessage`, а в ветке
  // комментариев им всегда оказывается комментарий.
  const saveEdit = useCallback(
    (original: ChatMessage, result: EditResult) => saveCommentEdit(original as CommentItem, result),
    [saveCommentEdit],
  );
  const edit = useMessageEdit({ chatId: commentThreadKey(messageId), draft, composerRef: inputRef, saveEdit });
  const runAction = useCommentActionHandlers({ thread, edit: edit.start });

  useEffect(() => {
    backRef.current = () => {
      if (!edit.mode) return false;

      void edit.leave();
      return true;
    };
  }, [backRef, edit]);

  const scrollToLatest = () => listRef.current?.scrollToOffset({ offset: 0, animated: true });

  const submit = edit.mode
    ? edit.save
    : () => {
        thread.send(draft.text, draft.media());
        draft.clear();
        scrollToLatest();
      };

  const sendVoice = (voice: LocalMedia) => {
    thread.sendVoice(voice);
    scrollToLatest();
  };

  const openPerson = useCallback(
    (userId: string) => {
      onClose();
      onOpenPerson(userId);
    },
    [onClose, onOpenPerson],
  );

  const { retry } = thread;
  const renderBubble = useCallback(
    (item: CommentItem, interactive = true) => {
      const { authorId } = item;

      return (
        <MessageBubble
          message={item}
          isOwn={authorId !== null && authorId === currentUserId}
          isRead={false}
          showReceipt={false}
          authorName={item.authorName ?? DELETED_ACCOUNT}
          authorAvatarUrl={item.authorAvatarUrl}
          authorBadge={item.audience === 'member' ? MEMBER_BADGE : null}
          mediaBounds={mediaBounds}
          onRetry={retry}
          onAuthorPress={interactive && authorId ? () => openPerson(authorId) : undefined}
        />
      );
    },
    [currentUserId, mediaBounds, openPerson, retry],
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
  const closed = about?.state === 'deleted' || about?.state === 'missing';
  const menuComment = menu.target?.item ?? null;
  const menuActions = menuComment
    ? visibleCommentActions({
        comment: menuComment,
        isOwn: menuComment.authorId === currentUserId,
        targetLive: !closed,
      })
    : [];

  return (
    <>
      {/* Шапка и сообщение — та часть шита, за которую его тянут. */}
      <View onLayout={(event) => onRegionLayout(event.nativeEvent.layout.height)}>
        <View onLayout={(event) => onHeaderLayout(event.nativeEvent.layout.height)}>
          <PanelHeader
            title={count > 0 ? commentsCountLabel(count) : 'Комментарии'}
            dragGesture={headerGesture}
            onClose={onClose}
          />
        </View>

        <GestureDetector gesture={targetGesture}>
          <Animated.View style={styles.targetFrame}>
            <Animated.View style={[styles.targetClip, targetStyle]}>
              <CommentTargetView
                target={about}
                bubble={targetBubble}
                onExpandedChange={setTargetExpanded}
              />
            </Animated.View>
          </Animated.View>
        </GestureDetector>
      </View>

      <CommentList
        listRef={listRef}
        comments={thread.comments}
        isLoading={thread.isLoading}
        isLoadingMore={thread.isLoadingMore}
        hasMore={thread.hasMore}
        error={thread.error}
        editingId={edit.mode?.message.id ?? null}
        closed={closed}
        loadMore={thread.loadMore}
        onOpenMenu={menu.open}
        renderBubble={renderBubble}
      />

      <View onLayout={(event) => onComposerLayout(event.nativeEvent.layout.height)}>
        <CommentComposer
          draft={draft}
          edit={edit}
          inputRef={inputRef}
          closed={closed}
          onSend={submit}
          onSendVoice={sendVoice}
          onFieldActivate={onFieldActivate}
        />
      </View>

      <MessageContextMenu
        anchor={menu.target?.anchor ?? null}
        preview={menuComment ? renderBubble(menuComment, false) : null}
        actions={menuActions}
        reactions={null}
        alignEnd={menuComment?.authorId === currentUserId}
        leadingInset={BUBBLE_LEADING_INSET}
        onAction={(id) => menuComment && runAction(id, menuComment)}
        onClose={menu.close}
      />
    </>
  );
}
