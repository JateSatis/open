import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Modal,
  Pressable,
  useWindowDimensions,
  View,
  type ViewToken,
} from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatThreadFooter } from './ChatThreadFooter';
import type { ChatThreadPanelKit } from './kit';
import { styles } from './styles';
import { useChatThreadActions } from './useChatThreadActions';
import { useChatThreadJump } from './useChatThreadJump';
import { useChatThreadRenderItem } from './useChatThreadRenderItem';

import { ConfirmDialogSurface } from '@/components/ConfirmDialog';
import { dismissTopConfirmDialog } from '@/components/ConfirmDialog/store';
import { Text } from '@/components/Text';
import {
  closeChatThread,
  type OpenChatThread,
} from '@/features/chats/chatThreads/chatThreadPanelStore';
import { useChatThreadSummaries } from '@/features/chats/chatThreads/summaries';
import {
  useChatThreadPane,
  type ChatThreadPaneRow,
} from '@/features/chats/chatThreads/useChatThreadPane';
import {
  setChatThreadKeyboardWindowOpen,
  useOwnKeyboardHeight,
} from '@/features/chats/composerKeyboard';
import { closeEmojiPanel } from '@/features/chats/EmojiPanel';
import { MessageContextMenu } from '@/features/chats/MessageContextMenu';
import type { ChatListRow } from '@/features/chats/islands/rows';
import {
  createRowRegistry,
  measureInWindow,
  RowRegistryContext,
} from '@/features/chats/rowRegistry';
import { useMessageViews } from '@/features/chats/useMessageViews';
import { repliesLabel } from '@/features/interactions/CommentsPanel/RepliesButton';
import { useSidePanel } from '@/features/interactions/CommentsPanel/useSidePanel';
import { TileViewportContext } from '@/features/media/tileRegistry';
import { InAppNoticeToast } from '@/features/notifications/InAppMessageToast/NoticeToast';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export type ChatThreadWindowProps = {
  kit: ChatThreadPanelKit;
  open: OpenChatThread;
};

const rowKey = (row: ChatThreadPaneRow) => row.key;
const NO_ROOTS: string[] = [];
/** Положение прокрутки учёту просмотров нужно лишь примерно. */
const VIEWS_SCROLL_THROTTLE_MS = 100;
/** Столько ждать `onShow`, прежде чем начать выезд самим. */
const SHOW_FALLBACK_MS = 300;

/**
 * Шторка треда: справа, на 90% ширины, слева затемнённая переписка. Сверху
 * исходное сообщение на фоне островка, ниже ответы по порядку — те же
 * облачка, меню и действия, что в переписке. Внизу — поле ввода участника.
 * Своё окно (`Modal`) — иначе шапку экрана не перекрыть; механика выезда и
 * закрытия — та же, что у боковой панели фрагмента (`useSidePanel`).
 */
export function ChatThreadWindow({ kit, open }: ChatThreadWindowProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: appWindowHeight } = useWindowDimensions();
  const [windowHeight, setWindowHeight] = useState(appWindowHeight);
  const width = Math.round(screenWidth * Sizes.fragmentPanelShare);
  const panel = useSidePanel({ width, windowHeight, onClosed: closeChatThread });
  const { close, markShown } = panel;
  const { chatId, rootId } = open;
  const keyboard = useOwnKeyboardHeight('comments');
  const listRef = useRef<FlatList<ChatThreadPaneRow>>(null);
  const listFrameRef = useRef<View>(null);
  const measureList = useCallback(() => measureInWindow(listFrameRef.current), []);
  const summaries = useChatThreadSummaries(chatId, NO_ROOTS, false);
  const summary = summaries[rootId] ?? null;
  const pane = useChatThreadPane(chatId, rootId, summary);
  const actions = useChatThreadActions({
    kit,
    rootId,
    root: pane.root,
    newestReply: pane.newestReply,
    bubbleRows: pane.bubbleRows,
    measureList,
    close,
  });
  const { selection, menu, edit, draft } = actions;

  // Выезд начинается по `onShow` окна. На Android оно приходит не всегда —
  // особенно если окно открыли посреди перерисовки списка: шторка осталась бы
  // за краем, а невидимое окно ловило бы касания. Запасной старт — по таймеру.
  useEffect(() => {
    const timer = setTimeout(markShown, SHOW_FALLBACK_MS);

    return () => clearTimeout(timer);
  }, [markShown]);

  // Поле чата под шторкой теряет фокус, клавиатура принадлежит шторке.
  useEffect(() => {
    Keyboard.dismiss();
    setChatThreadKeyboardWindowOpen(true);

    return () => setChatThreadKeyboardWindowOpen(false);
  }, []);

  const { rows } = pane;
  const { highlight, jumpInPane, onScrollToIndexFailed, onScroll: trackEnd, onContentSizeChange } = useChatThreadJump({
    listRef,
    rows,
    loadUntil: pane.loadUntil,
    isLoading: pane.isLoading,
    focusMessageId: open.focusMessageId,
  });

  // Просмотры и «прочитано» ответов, прочитанных в шторке, — как в переписке.
  const [rowRegistry] = useState(createRowRegistry);
  const views = useMessageViews({
    chatId,
    currentUserId: kit.currentUserId,
    isFocused: true,
    rows: pane.bubbleRows,
    autoscrollThreshold: 0,
    measureRow: rowRegistry.measure,
    measureViewport: measureList,
  });
  const { onViewableItemsChanged: viewsOnViewable } = views;
  const { onScroll: viewsOnScroll } = views;
  const onScroll = useCallback((event: Parameters<typeof trackEnd>[0]) => {
    trackEnd(event);
    viewsOnScroll(event);
  }, [trackEnd, viewsOnScroll]);
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<ChatThreadPaneRow>[] }) =>
      viewsOnViewable({
        viewableItems: viewableItems.filter(
          (token): token is ViewToken<ChatThreadPaneRow & ChatListRow> =>
            token.item?.type === 'message',
        ),
      }),
    [viewsOnViewable],
  );

  const { renderItem, bubbleFor } = useChatThreadRenderItem({
    kit,
    pane,
    actions,
    width,
    highlight,
    jumpInPane,
  });

  /** «Назад» закрывает сначала вопрос, панель эмодзи, выбор, правку и ответ, потом шторку. */
  const handleBack = useCallback(() => {
    if (dismissTopConfirmDialog()) return;
    if (closeEmojiPanel('comments')) return;

    if (selection.isActive) {
      selection.clear();
      return;
    }

    if (edit.mode) {
      void edit.leave();
      return;
    }

    if (draft.mode) {
      draft.setMode(null);
      return;
    }

    close();
  }, [close, draft, edit, selection]);

  const spacerStyle = useAnimatedStyle(() => ({
    height: Math.max(keyboard.value - insets.bottom, 0) + insets.bottom,
  }));

  const count = summary?.repliesCount ?? pane.bubbleRows.length - 1;

  return (
    <Modal
      testID="chat-thread-panel"
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={handleBack}
      onShow={markShown}
    >
      <GestureHandlerRootView
        style={styles.root}
        onLayout={(event) => setWindowHeight(event.nativeEvent.layout.height)}
      >
        <Animated.View
          pointerEvents="box-none"
          style={[styles.fill, { backgroundColor: theme.overlay }, panel.backdropStyle]}
        >
          <Pressable
            testID="chat-thread-backdrop"
            accessibilityLabel="Закрыть тред"
            style={[styles.backdropTapTarget, { width: screenWidth - width }]}
            onPress={close}
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.panel,
            { width, paddingTop: insets.top, backgroundColor: theme.background },
            panel.shiftStyle,
          ]}
        >
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <Text variant="bodyBold">Тред</Text>
            {count > 0 ? (
              <Text variant="small" color="textSecondary">
                {repliesLabel(count)}
              </Text>
            ) : null}
          </View>

          <GestureDetector gesture={panel.main.dismissPan}>
            <View ref={listFrameRef} style={styles.list} collapsable={false}>
              <RowRegistryContext.Provider value={rowRegistry}>
              <TileViewportContext.Provider value={measureList}>
                <FlatList
                  ref={listRef}
                  testID="chat-thread-list"
                  data={pane.rows}
                  keyExtractor={rowKey}
                  renderItem={renderItem}
                  contentContainerStyle={styles.listContent}
                  showsVerticalScrollIndicator={false}
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  onScrollToIndexFailed={onScrollToIndexFailed}
                  viewabilityConfig={views.viewabilityConfig}
                  onViewableItemsChanged={onViewableItemsChanged}
                  onScroll={onScroll}
                  onContentSizeChange={onContentSizeChange}
                  scrollEventThrottle={VIEWS_SCROLL_THROTTLE_MS}
                />
              </TileViewportContext.Provider>
              </RowRegistryContext.Provider>
            </View>
          </GestureDetector>

          <ChatThreadFooter
            actions={actions}
            currentUserId={kit.currentUserId}
            isMember={kit.isMember}
            title={kit.sourceChat.name}
            onTyping={kit.notifyTyping}
            onRecordingVoice={kit.notifyRecordingVoice}
          />
          <Animated.View style={spacerStyle} />
        </Animated.View>

        <MessageContextMenu
          anchor={menu.target?.anchor ?? null}
          viewport={menu.target?.viewport ?? null}
          preview={
            actions.menuRow && actions.menuRow.type !== 'island-header' && actions.menuContent
              ? bubbleFor(actions.menuRow, false)
              : null
          }
          actions={actions.menuActions}
          reactions={actions.menuReactions}
          onAction={actions.runMenuAction}
          onClose={menu.close}
          journalSubject={
            actions.menuContent ? { type: 'message', id: actions.menuContent.id } : null
          }
        />

        <ConfirmDialogSurface />
        <InAppNoticeToast />
      </GestureHandlerRootView>
    </Modal>
  );
}
