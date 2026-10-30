import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Modal,
  Pressable,
  useWindowDimensions,
  View,
} from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatThreadFooter } from './ChatThreadFooter';
import type { ChatThreadPanelKit } from './kit';
import { styles } from './styles';
import { useChatThreadActions } from './useChatThreadActions';

import type { QuotedMessage } from '@/api/chats';
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
import { DeletedOriginal } from '@/features/chats/DeletedOriginal';
import { closeEmojiPanel } from '@/features/chats/EmojiPanel';
import { mosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { bubbleAsideWidth } from '@/features/chats/MessageBubble/layout';
import { MessageContextMenu } from '@/features/chats/MessageContextMenu';
import { measureInWindow } from '@/features/chats/rowRegistry';
import { useChatBubbles } from '@/features/chats/useChatBubbles';
import { useChatRowRenderer } from '@/features/chats/useChatRowRenderer';
import type { JumpHighlight } from '@/features/chats/useJumpToMessage';
import { repliesLabel } from '@/features/interactions/CommentsPanel/RepliesButton';
import { useSidePanel } from '@/features/interactions/CommentsPanel/useSidePanel';
import { TileViewportContext } from '@/features/media/tileRegistry';
import { InAppNoticeToast } from '@/features/notifications/InAppMessageToast/NoticeToast';
import { useTheme } from '@/hooks/use-theme';
import { Sizes, Spacing } from '@/theme';

export type ChatThreadWindowProps = {
  kit: ChatThreadPanelKit;
  open: OpenChatThread;
};

const rowKey = (row: ChatThreadPaneRow) => row.key;
const NO_ROOTS: string[] = [];
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

  // Переход по цитате внутри шторки: к сообщению треда, с подсветкой. Цель —
  // в ref: после догрузки разрыва строка появляется на следующей отрисовке.
  const [highlight, setHighlight] = useState<JumpHighlight | null>(null);
  const [jumps, setJumps] = useState(0);
  const targetRef = useRef<string | null>(null);
  const { rows, loadUntil } = pane;

  useEffect(() => {
    const target = targetRef.current;
    const index = target ? rows.findIndex((row) => row.key === target) : -1;

    if (index === -1) return;

    targetRef.current = null;
    listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
  }, [jumps, rows]);

  const jumpInPane = useCallback(
    async (messageId: string, seq: number) => {
      if (!(await loadUntil(seq))) return;

      targetRef.current = messageId;
      setJumps((count) => count + 1);
      setHighlight({ messageId, key: Date.now() });
    },
    [loadUntil],
  );

  // Мой ответ из всплывашки — в конце треда: туда и прокрутить.
  const focused = useRef(false);

  useEffect(() => {
    if (focused.current || pane.isLoading || !open.focusMessageId) return;

    focused.current = true;

    const index =
      open.focusMessageId === 'end' ? -1 : rows.findIndex((row) => row.key === open.focusMessageId);

    requestAnimationFrame(() => {
      if (index === -1) listRef.current?.scrollToEnd({ animated: false });
      else listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
    });
  }, [open.focusMessageId, pane.isLoading, rows]);

  const { navigation } = kit;
  const paneNavigation = useMemo(
    () => ({
      ...navigation,
      openQuote: (quote: QuotedMessage) => {
        if (quote.state === 'live') void jumpInPane(quote.messageId, quote.seq);
      },
    }),
    [jumpInPane, navigation],
  );
  const mediaBounds = useMemo(
    () => mosaicBounds(width - Spacing.three * 2, false, bubbleAsideWidth(kit.showAvatars)),
    [kit.showAvatars, width],
  );
  const { bubbleFor } = useChatBubbles({
    chatId,
    currentUserId: kit.currentUserId,
    isMember: kit.isMember,
    participantsById: kit.peopleById,
    mediaBounds,
    retry: kit.retry,
    openPerson: kit.openPerson,
    navigation: paneNavigation,
    reactions: kit.reactions,
    showAvatars: kit.showAvatars,
    showAuthors: kit.showAuthors,
    openForwardedComment: kit.openForwardedComment,
  });
  const { renderItem: renderRow } = useChatRowRenderer({
    currentUserId: kit.currentUserId,
    isMember: kit.isMember,
    isSelecting: selection.isActive,
    isSelected: selection.isSelected,
    toggleSelected: selection.toggle,
    editingId: edit.mode?.message.id ?? null,
    highlight,
    bubbleFor,
    openMenu: menu.open,
    startReply: actions.startReply,
    retry: kit.retry,
    hostName: kit.authorName,
    openChat: navigation.openChat,
  });

  const renderItem = useCallback(
    ({ item: row }: { item: ChatThreadPaneRow }) => {
      if (row.type === 'chat-thread-gap') {
        return (
          <Pressable
            testID="chat-thread-gap"
            accessibilityRole="button"
            onPress={() => void pane.loadGap()}
            style={styles.action}
          >
            {pane.loadingGap ? (
              <ActivityIndicator accessibilityLabel="Загрузка ответов" />
            ) : (
              <Text variant="smallBold" color="primary">
                {`Показать ещё ${repliesLabel(row.hidden)}`}
              </Text>
            )}
          </Pressable>
        );
      }

      if (row.type === 'chat-thread-loading') {
        return row.failed ? (
          <Pressable testID="chat-thread-retry" onPress={pane.retry} style={styles.action}>
            <Text variant="small" color="danger">
              Не удалось загрузить тред. Повторить
            </Text>
          </Pressable>
        ) : (
          <View style={styles.action}>
            <ActivityIndicator accessibilityLabel="Загрузка треда" />
          </View>
        );
      }

      if (!row.chatThreadRoot) return renderRow({ item: row });

      return (
        <View
          testID="chat-thread-root"
          style={[styles.chatThreadRoot, { backgroundColor: theme.islandBackground }]}
        >
          {row.message.chatThreadDeletedRoot ? <DeletedOriginal /> : renderRow({ item: row })}
        </View>
      );
    },
    [pane, renderRow, theme.islandBackground],
  );

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
            style={styles.fill}
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
                  onScrollToIndexFailed={({ index, averageItemLength }) => {
                    listRef.current?.scrollToOffset({
                      offset: averageItemLength * index,
                      animated: false,
                    });
                    setTimeout(
                      () => listRef.current?.scrollToIndex({ index, viewPosition: 0.5 }),
                      120,
                    );
                  }}
                />
              </TileViewportContext.Provider>
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
