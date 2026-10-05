import { SymbolView } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { CommentForward, QuotedMessage } from '@/api/chats';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { DELETED_ACCOUNT } from '@/features/chats/messageQuote';
import { ReplyQuote } from '@/features/chats/ReplyQuote';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

export type CommentForwardLeadProps = {
  forward: CommentForward;
  /** Облачко своё (переслал я) — цвета на `primary`. */
  isOwn: boolean;
  /** Тап по сниппету или чату — к комментарию в его ветке. Нет — не нажимается (копия в меню). */
  onOpenSource?: () => void;
  /** Тап по автору комментария — его профиль. */
  onOpenAuthor?: () => void;
};

/**
 * Верх облачка пересланного комментария: пометка «комментарий» с чатом,
 * сниппет сообщения, под которым он оставлен, и автор комментария. Сам
 * комментарий — ниже, содержимым облачка. Так облачко читается в отрыве от
 * переписки и не путается с ответом: у ответа сверху цитата, а снизу
 * реплика того, кто отвечает, — здесь же снизу чужой комментарий со своим
 * автором.
 */
export function CommentForwardLead({
  forward,
  isOwn,
  onOpenSource,
  onOpenAuthor,
}: CommentForwardLeadProps) {
  const theme = useTheme();
  const { comment } = forward;
  const tone = isOwn ? 'primaryText' : 'textSecondary';
  const tint = isOwn ? theme.primaryText : theme.textSecondary;

  if (!comment) {
    return (
      <View testID="comment-forward-lead" style={styles.label}>
        <SymbolView
          name={{ ios: 'bubble.left', android: 'chat_bubble_outline', web: 'chat_bubble_outline' }}
          size={Sizes.commentsIconQuiet}
          tintColor={tint}
        />
        <Text variant="caption" color={tone}>
          Комментарий удалён
        </Text>
      </View>
    );
  }

  const { target, chat } = comment;
  const snippet: QuotedMessage = target
    ? {
        messageId: target.id,
        state: 'live',
        authorId: target.authorId,
        authorName: target.authorName,
        createdAt: comment.createdAt,
        editedAt: null,
        preview: target.preview,
      }
    : { messageId: comment.messageId, state: 'deleted' };
  const authorName = comment.authorName ?? DELETED_ACCOUNT;

  return (
    <View testID="comment-forward-lead" style={styles.lead}>
      <Pressable
        accessibilityRole={onOpenSource ? 'link' : undefined}
        disabled={!onOpenSource}
        onPress={onOpenSource}
        style={styles.label}
      >
        <SymbolView
          name={{ ios: 'bubble.left', android: 'chat_bubble_outline', web: 'chat_bubble_outline' }}
          size={Sizes.commentsIconQuiet}
          tintColor={tint}
        />
        <Text variant="caption" color={tone} numberOfLines={1} style={styles.labelText}>
          {chat ? `Комментарий из «${chat.name}»` : 'Комментарий из удалённого чата'}
        </Text>
      </Pressable>

      <ReplyQuote quotes={[snippet]} isOwn={isOwn} onPress={onOpenSource ? () => onOpenSource() : undefined} />

      <Pressable
        accessibilityRole={onOpenAuthor ? 'button' : undefined}
        accessibilityLabel={onOpenAuthor ? `Профиль: ${authorName}` : undefined}
        disabled={!onOpenAuthor}
        onPress={onOpenAuthor}
        style={styles.author}
      >
        <Avatar uri={comment.authorAvatarUrl} name={authorName} size={Sizes.forwardedAuthorAvatar} />
        <Text variant="smallBold" color={isOwn ? 'primaryText' : 'text'} numberOfLines={1}>
          {authorName}
        </Text>
      </Pressable>
    </View>
  );
}
