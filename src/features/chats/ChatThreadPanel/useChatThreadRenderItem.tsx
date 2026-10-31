import { useCallback, useMemo } from 'react';
import { View } from 'react-native';

import type { ChatThreadPanelKit } from './kit';
import { styles } from './styles';
import type { useChatThreadActions } from './useChatThreadActions';
import { ChatThreadActionRow } from './ChatThreadActionRow';

import type { QuotedMessage } from '@/api/chats';
import type {
  ChatThreadPaneRow,
  useChatThreadPane,
} from '@/features/chats/chatThreads/useChatThreadPane';
import { DeletedOriginal } from '@/features/chats/DeletedOriginal';
import { mosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { bubbleAsideWidth } from '@/features/chats/MessageBubble/layout';
import { useChatBubbles } from '@/features/chats/useChatBubbles';
import { useChatRowRenderer } from '@/features/chats/useChatRowRenderer';
import type { JumpHighlight } from '@/features/chats/useJumpToMessage';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

type Options = {
  kit: ChatThreadPanelKit;
  pane: ReturnType<typeof useChatThreadPane>;
  actions: ReturnType<typeof useChatThreadActions>;
  /** Ширина шторки — по ней мозаика медиа. */
  width: number;
  highlight: JumpHighlight | null;
  /** Тап по цитате — к сообщению внутри шторки, а не в переписке. */
  jumpInPane: (messageId: string, seq: number) => Promise<void>;
};

/**
 * Строки шторки — те же облачки, меню, выбор и свайп ответа, что в
 * переписке; корень — на фоне островка, плюс разрыв и загрузка треда.
 */
export function useChatThreadRenderItem({ kit, pane, actions, width, highlight, jumpInPane }: Options) {
  const theme = useTheme();
  const { chatId } = kit;
  const { navigation } = kit;
  const { selection, menu, edit } = actions;
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
          <ChatThreadActionRow
            type="gap"
            hidden={row.hidden}
            loading={pane.loadingGap}
            onPress={() => void pane.loadGap()}
          />
        );
      }

      if (row.type === 'chat-thread-loading') {
        return <ChatThreadActionRow type="loading" failed={row.failed} onRetry={pane.retry} />;
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


  return { renderItem, bubbleFor };
}
