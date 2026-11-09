import { useCallback, useMemo } from 'react';
import { View } from 'react-native';

import type { ChatThreadPanelKit } from './kit';
import { styles } from './styles';
import type { useChatThreadActions } from './useChatThreadActions';
import { ChatThreadActionRow } from './ChatThreadActionRow';

import type {
  ChatThreadPaneRow,
  useChatThreadPane,
} from '@/features/chats/chatThreads/useChatThreadPane';
import { DeletedOriginal } from '@/features/chats/DeletedOriginal';
import { mosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { bubbleAsideWidth } from '@/features/chats/MessageBubble/layout';
import { useChatBubbles } from '@/features/chats/useChatBubbles';
import { useChatRowRenderer } from '@/features/chats/useChatRowRenderer';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

type Options = {
  kit: ChatThreadPanelKit;
  pane: ReturnType<typeof useChatThreadPane>;
  actions: ReturnType<typeof useChatThreadActions>;
  /** Ширина шторки — по ней мозаика медиа. */
  width: number;
};

/**
 * Строки шторки — те же облачки, меню, выбор и свайп ответа, что в
 * переписке; корень — на фоне островка, плюс разрыв и загрузка треда.
 */
export function useChatThreadRenderItem({ kit, pane, actions, width }: Options) {
  const theme = useTheme();
  const { chatId } = kit;
  const { selection, menu, edit } = actions;
  const people = useMemo(() => {
    const result = new Map(kit.peopleById);

    for (const row of pane.bubbleRows) {
      if (row.type !== 'message') continue;
      const { authorId, author } = row.message;
      if (authorId && author) result.set(authorId, { id: authorId, ...author });
    }

    return result;
  }, [kit.peopleById, pane.bubbleRows]);
  const mediaBounds = useMemo(
    () => mosaicBounds(width - Spacing.three * 2, false, bubbleAsideWidth(kit.showAvatars)),
    [kit.showAvatars, width],
  );
  const { bubbleFor } = useChatBubbles({
    chatId,
    currentUserId: kit.currentUserId,
    isMember: kit.isMember,
    participantsById: people,
    mediaBounds,
    retry: kit.retry,
    openPerson: kit.openPerson,
    reactions: kit.reactions,
    showAvatars: kit.showAvatars,
    showAuthors: kit.showAuthors,
  });
  const { renderItem: renderRow } = useChatRowRenderer({
    currentUserId: kit.currentUserId,
    isMember: kit.isMember,
    isSelecting: selection.isActive,
    isSelected: selection.isSelected,
    toggleSelected: selection.toggle,
    editingId: edit.mode?.message.id ?? null,
    bubbleFor,
    openMenu: menu.open,
    startReply: actions.startReply,
    retry: kit.retry,
    hostName: (id) => (id ? people.get(id)?.displayName : null) ?? kit.authorName(id),
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
