import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { SearchMessage } from '@/api/search';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { formatChatTimestamp } from '@/features/chats/chatDisplay';
import { HighlightedText } from '@/features/search/HighlightedText';
import { findMatches, snippetAround } from '@/features/search/searchText';
import { Sizes } from '@/theme';

export type SearchMessageRowProps = {
  message: SearchMessage;
  /** Нормализованный текст запроса — что подсветить во фрагменте. */
  needle: string;
  onPress: (message: SearchMessage) => void;
};

/**
 * Строка найденного сообщения: чат или канал, автор (в группе), фрагмент
 * вокруг совпадения с подсветкой и время.
 */
export function SearchMessageRow({ message, needle, onPress }: SearchMessageRowProps) {
  const snippet = snippetAround(message.text, findMatches(message.text, needle));
  // В личном диалоге автор понятен из самого чата, в канале пишет канал.
  const author = message.chatKind === 'group' ? message.authorName : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${message.chatTitle}: ${message.text}`}
      testID="search-message"
      onPress={() => onPress(message)}
      style={styles.row}
    >
      <Avatar uri={message.chatAvatarUrl} name={message.chatTitle} size={Sizes.chatListAvatar} />
      <View style={styles.body}>
        <View style={styles.header}>
          <Text variant="bodyBold" numberOfLines={1} style={styles.title}>
            {message.chatTitle}
          </Text>
          <Text variant="caption" color="textSecondary">
            {formatChatTimestamp(message.createdAt)}
          </Text>
        </View>
        <Text variant="small" color="textSecondary" numberOfLines={2}>
          {author ? <Text variant="small">{`${author}: `}</Text> : null}
          <HighlightedText variant="small" color="textSecondary" ranges={snippet.ranges}>
            {snippet.text}
          </HighlightedText>
        </Text>
      </View>
    </Pressable>
  );
}
