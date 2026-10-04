import { memo, type ReactNode } from 'react';
import { View } from 'react-native';

import type { ThreadPlace } from './rows';
import { styles } from './styles';
import { ThreadBackground } from './ThreadBackground';
import { ThreadToggle } from './ThreadToggle';

import { Text } from '@/components/Text';
import { isLocalMessage } from '@/features/chats/messageActions';
import type { AnchorRect } from '@/features/chats/MessageContextMenu';
import { MessageRow } from '@/features/chats/MessageRow';
import type { CommentItem } from '@/features/interactions/comments/commentItem';
import { useTheme } from '@/hooks/use-theme';

export type CommentRowViewProps = {
  comment: CommentItem;
  thread: ThreadPlace | null;
  /** У корня — число на кнопке треда; 0 — кнопки нет. */
  replies: number;
  selectionMode: boolean;
  selected: boolean;
  editing: boolean;
  highlightKey: number | null;
  /** Тред этого корня раскрыт. */
  threadOpen: boolean;
  onOpenMenu: (comment: CommentItem, anchor: AnchorRect) => void;
  onSelect: (comment: CommentItem) => void;
  onToggle: (comment: CommentItem) => void;
  /** Свайп влево — ответить. Нет — у удалённого сообщения ответов не принимают. */
  onSwipeReply?: (comment: CommentItem) => void;
  onToggleThread: (rootId: string) => void;
  /** Облачко — то же, что у сообщения в переписке; `aside` — кнопка треда сбоку. */
  renderBubble: (comment: CommentItem, aside: ReactNode) => ReactNode;
};

/** Облачко удалённого корня: тред живёт, на месте корня — заглушка. */
function DeletedRoot({ aside }: { aside: ReactNode }) {
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
      {aside}
    </View>
  );
}

/**
 * Строка комментария: облачко с жестами переписки — тап открывает меню,
 * долгое нажатие включает выбор, свайп влево отвечает. Ответ в треде — на
 * «таб» правее корня, раскрытый тред — на общем фоне.
 */
export const CommentRowView = memo(function CommentRowView({
  comment,
  thread,
  replies,
  selectionMode,
  selected,
  editing,
  highlightKey,
  threadOpen,
  onOpenMenu,
  onSelect,
  onToggle,
  onSwipeReply,
  onToggleThread,
  renderBubble,
}: CommentRowViewProps) {
  const isReply = comment.threadRootId !== null;
  const aside =
    !isReply && replies > 0 ? (
      <ThreadToggle count={replies} open={threadOpen} onPress={() => onToggleThread(comment.id)} />
    ) : null;
  const background = thread ? <ThreadBackground first={thread.first} last={thread.last} /> : null;

  if (comment.deleted) {
    return (
      <View style={styles.row}>
        {background}
        <DeletedRoot aside={aside} />
      </View>
    );
  }

  const selectable = !isLocalMessage(comment);

  return (
    <View style={styles.row}>
      {background}
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
        <View style={isReply ? styles.replyBubble : undefined}>{renderBubble(comment, aside)}</View>
      </MessageRow>
    </View>
  );
});
