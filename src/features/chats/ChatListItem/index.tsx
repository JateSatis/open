import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { ChatSummary } from '@/api/chats';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { chatAvatarUrl, chatTitle, formatChatTimestamp } from '@/features/chats/chatDisplay';
import { useTheme } from '@/hooks/use-theme';

export type ChatListItemProps = {
  chat: ChatSummary;
  currentUserId: string | null;
  isOnline: boolean;
  onPress: (chatId: string) => void;
};

export function ChatListItem({ chat, currentUserId, isOnline, onPress }: ChatListItemProps) {
  const theme = useTheme();
  const title = chatTitle(chat, currentUserId);
  const status =
    chat.kind === 'group'
      ? `${chat.participants.length} участников`
      : isOnline
        ? 'в сети'
        : 'не в сети';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={() => onPress(chat.id)}
      style={styles.row}
    >
      <Avatar uri={chatAvatarUrl(chat, currentUserId)} name={title} />

      <View style={styles.body}>
        <View style={styles.header}>
          <Text variant="bodyBold" numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          <Text variant="caption" color="textSecondary">
            {formatChatTimestamp(chat.lastMessageAt)}
          </Text>
        </View>

        <Text variant="small" color="textSecondary" numberOfLines={1}>
          {chat.lastMessagePreview ?? 'Нет сообщений'}
        </Text>

        <View style={styles.status}>
          {chat.kind === 'direct' && isOnline ? (
            <View style={[styles.onlineDot, { backgroundColor: theme.success }]} />
          ) : null}
          <Text variant="caption" color="textSecondary">
            {status}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
