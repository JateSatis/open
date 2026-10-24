import { SymbolView } from 'expo-symbols';
import { useRef } from 'react';
import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { ChatSummary } from '@/api/chats';
import { Avatar } from '@/components/Avatar';
import { AvatarPair } from '@/components/AvatarPair';
import { SelectionCheck } from '@/components/SelectionCheck';
import { Text } from '@/components/Text';
import {
  chatAvatarUrl,
  chatTitle,
  dialogPair,
  formatChatTimestamp,
} from '@/features/chats/chatDisplay';
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
  /**
   * Строка — пункт выбора (лист «Кому переслать»): справа отметка, нажатие
   * отмечает и снимает. Нет — обычная строка «Чатов».
   */
  selected?: boolean;
};

export function ChatListItem({
  chat,
  currentUserId,
  isOnline,
  onPress,
  onLongPress,
  selected,
}: ChatListItemProps) {
  const theme = useTheme();
  const rowRef = useRef<View>(null);
  const title = chatTitle(chat, currentUserId);
  // Чужой диалог — двое внахлёст: сразу видно, что переписка не моя с одним из них.
  const pair = dialogPair(chat, currentUserId);
  const waiting = chat.waiting.length;
  const status =
    chat.kind === 'channel'
      ? 'Канал'
      : pair
        ? null
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
      accessibilityRole={selected === undefined ? 'button' : 'checkbox'}
      accessibilityLabel={title}
      accessibilityState={selected === undefined ? undefined : { checked: selected }}
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
      {pair && pair.length === 2 ? (
        <AvatarPair
          testID="chat-avatar-pair"
          first={{ uri: pair[0].avatarUrl, name: pair[0].displayName }}
          second={{ uri: pair[1].avatarUrl, name: pair[1].displayName }}
          size={Sizes.chatListAvatar}
        />
      ) : (
        <Avatar uri={chatAvatarUrl(chat, currentUserId)} name={title} size={Sizes.chatListAvatar} />
      )}

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

      {selected !== undefined ? (
        <SelectionCheck checked={selected} />
      ) : chat.hasUnread ? (
        <View
          accessibilityLabel="Есть непрочитанные сообщения"
          style={[styles.unreadDot, { backgroundColor: theme.primary }]}
        />
      ) : null}
    </Pressable>
  );
}
