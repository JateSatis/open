import { SymbolView } from 'expo-symbols';
import { memo, type ReactNode } from 'react';
import { View } from 'react-native';

import { RepliesButton } from './RepliesButton';
import { styles } from './styles';

import { Text } from '@/components/Text';
import { isLocalMessage } from '@/features/chats/messageActions';
import type { MenuAnchor } from '@/features/chats/MessageContextMenu';
import { MessageRow } from '@/features/chats/MessageRow';
import type { CommentItem } from '@/features/interactions/comments/commentItem';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export type CommentRowViewProps = {
  comment: CommentItem;
  /** Корень в окне треда — на фоне островка. */
  threadRoot: boolean;
  /** Число на кнопке «N ответов» под облачком; 0 — кнопки нет. */
  replies: number;
  /** Закреплён автором контента: строкой над облачком «Закреплено автором». */
  pinned?: boolean;
  isOwn: boolean;
  selectionMode: boolean;
  selected: boolean;
  editing: boolean;
  highlightKey: number | null;
  onOpenMenu: (comment: CommentItem, anchor: MenuAnchor) => void;
  onSelect: (comment: CommentItem) => void;
  onToggle: (comment: CommentItem) => void;
  /** Свайп влево — ответить. Нет — у удалённого сообщения ответов не принимают. */
  onSwipeReply?: (comment: CommentItem) => void;
  onOpenThread: (rootId: string) => void;
  /** Облачко — то же, что у сообщения в переписке. */
  renderBubble: (comment: CommentItem) => ReactNode;
};

/** Облачко удалённого корня: тред живёт, на месте корня — заглушка. */
function DeletedRoot() {
  const theme = useTheme();

  return (
    <View style={styles.deletedRow}>
      <View style={styles.avatarSlot} />
      <View
        testID="deleted-comment"
        style={[styles.deletedBubble, { backgroundColor: theme.backgroundElement }]}
      >
        <Text variant="small" color="textSecondary">
          Комментарий удалён
        </Text>
      </View>
    </View>
  );
}

/**
 * Метка закрепа — строкой над облачком, а не у имени: рядом с именем уже
 * стоит ряд («Автор», «участник чата»), и закреп с ним не спорит.
 */
function PinnedLabel() {
  const theme = useTheme();

  return (
    <View testID="comment-pinned-label" style={styles.pinnedLabel}>
      <SymbolView
        name={{ ios: 'pin.fill', android: 'push_pin', web: 'push_pin' }}
        size={Sizes.commentsIconQuiet}
        tintColor={theme.textSecondary}
      />
      <Text variant="caption" color="textSecondary">
        Закреплено автором
      </Text>
    </View>
  );
}

/**
 * Строка комментария: облачко с жестами переписки — тап открывает меню,
 * долгое нажатие включает выбор, свайп влево отвечает. Под облачком корня с
 * ответами — «N ответов»; корень в окне треда — на фоне островка.
 */
export const CommentRowView = memo(function CommentRowView({
  comment,
  threadRoot,
  replies,
  pinned = false,
  isOwn,
  selectionMode,
  selected,
  editing,
  highlightKey,
  onOpenMenu,
  onSelect,
  onToggle,
  onSwipeReply,
  onOpenThread,
  renderBubble,
}: CommentRowViewProps) {
  const theme = useTheme();
  const button =
    replies > 0 ? (
      <RepliesButton
        count={replies}
        isOwn={isOwn && !comment.deleted}
        onPress={() => onOpenThread(comment.id)}
      />
    ) : null;
  const rowStyle = threadRoot
    ? [styles.threadRoot, { backgroundColor: theme.islandBackground }]
    : styles.row;

  if (comment.deleted) {
    return (
      <View testID={threadRoot ? 'thread-root' : undefined} style={rowStyle}>
        {pinned ? <PinnedLabel /> : null}
        <DeletedRoot />
        {button}
      </View>
    );
  }

  const selectable = !isLocalMessage(comment);

  return (
    <View testID={threadRoot ? 'thread-root' : undefined} style={rowStyle}>
      {pinned ? <PinnedLabel /> : null}
      <MessageRow
        selectionMode={selectionMode}
        selectable={selectable}
        selected={selected}
        editing={editing}
        highlightKey={highlightKey}
        messageId={comment.id}
        onOpenMenu={(anchor) => onOpenMenu(comment, anchor)}
        onSelect={selectable ? () => onSelect(comment) : undefined}
        onToggle={() => onToggle(comment)}
        onSwipeReply={onSwipeReply && selectable ? () => onSwipeReply(comment) : undefined}
      >
        {renderBubble(comment)}
      </MessageRow>
      {button}
    </View>
  );
});
