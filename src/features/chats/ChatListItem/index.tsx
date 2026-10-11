import { SymbolView } from 'expo-symbols';
import { useRef } from 'react';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { ChatSummary } from '@/api/chats';
import { Avatar } from '@/components/Avatar';
import { Text } from '@/components/Text';
import { chatAvatarUrl, chatTitle, formatChatTimestamp } from '@/features/chats/chatDisplay';
import { useTheme } from '@/hooks/use-theme';
import { Sizes } from '@/theme';

/** Где строка на экране — от этого места меню долгого нажатия. */
export type RowRect = { x: number; y: number; width: number; height: number };

export type ChatListItemProps = {
  chat: ChatSummary;
  currentUserId: string | null;
  /** `undefined` — присутствие не известно здесь, и строки «в сети» нет. */
  isOnline?: boolean;
  onPress: (chatId: string) => void;
  /** Долгое нажатие; нет — строка его не ловит. */
  onLongPress?: (chat: ChatSummary, rect: RowRect) => void;
};

export function ChatListItem({
  chat,
  currentUserId,
  isOnline,
  onPress,
  onLongPress,
}: ChatListItemProps) {
  const theme = useTheme();
  const rowRef = useRef<View>(null);
  const title = chatTitle(chat, currentUserId);
  const waiting = chat.waiting.length;
  const status =
    chat.kind === 'channel'
      ? 'Канал'
      : chat.kind === 'group'
        ? `${chat.participants.length} участников${waiting > 0 ? ` · ждём ответа: ${waiting}` : ''}`
        : waiting > 0
          ? 'ждём ответа на заявку'
          : isOnline === undefined
            ? null
            : isOnline
              ? 'в сети'
              : 'не в сети';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      testID="chat-list-item"
      ref={rowRef}
      onPress={() => onPress(chat.id)}
      onLongPress={
        onLongPress
          ? () =>
              rowRef.current?.measureInWindow((x, y, width, height) =>
                onLongPress(chat, { x, y, width, height }),
              )
          : undefined
      }
      style={styles.row}
    >
      <Avatar uri={chatAvatarUrl(chat, currentUserId)} name={title} />

      <View style={styles.body}>
        <View style={styles.header}>
          <Text variant="bodyBold" numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          <Text variant="caption" color="textSecondary">
            {formatChatTimestamp(chat.lastActivityAt)}
          </Text>
        </View>

        {chat.previewIsPop ? (
          <View testID="chat-preview-pop" style={styles.status}>
            <SymbolView
              name={{ ios: 'video.fill', android: 'videocam', web: 'videocam' }}
              size={Sizes.chatPreviewIcon}
              tintColor={chat.hasUnread ? theme.text : theme.textSecondary}
            />
            <Text variant="small" color={chat.hasUnread ? 'text' : 'textSecondary'} numberOfLines={1}>
              Новый попс
            </Text>
          </View>
        ) : (
          <Text variant="small" color={chat.hasUnread ? 'text' : 'textSecondary'} numberOfLines={1}>
            {chat.lastMessagePreview ?? 'Нет сообщений'}
          </Text>
        )}

        {status ? (
          <View style={styles.status}>
            {chat.kind === 'direct' && waiting === 0 && isOnline ? (
              <View style={[styles.onlineDot, { backgroundColor: theme.success }]} />
            ) : null}
            <Text variant="caption" color="textSecondary">
              {status}
            </Text>
          </View>
        ) : null}
      </View>

      {chat.hasUnread ? (
        <View
          accessibilityLabel="Есть непрочитанные сообщения"
          style={[styles.unreadDot, { backgroundColor: theme.primary }]}
        />
      ) : null}
    </Pressable>
  );
}
