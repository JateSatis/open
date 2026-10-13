import { useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { styles } from './styles';

import { Avatar } from '@/components/Avatar';
import { LoadFailed } from '@/components/LoadFailed';
import { Text } from '@/components/Text';
import { chatAvatarUrl, chatTitle, isChatMember } from '@/features/chats/chatDisplay';
import { ChatUsernameForm } from '@/features/chats/ChatUsernameForm';
import { GroupAvatarEditor } from '@/features/chats/GroupAvatarEditor';
import { chatQueryKey, useChat } from '@/features/chats/useChat';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { formatUsername } from '@/features/profile/username';
import { useTheme } from '@/hooks/use-theme';
import { plural } from '@/lib/plural';
import { reloadMissing } from '@/lib/loadState';
import { Spacing } from '@/theme';

const AVATAR_SIZE = Spacing.six * 1.5;

export type ChatInfoScreenProps = {
  chatId: string;
};

/**
 * «О чате» группы: аватар, название, число участников и `@имя.di`. Участник
 * может поставить, сменить и убрать фото и имя; посторонний их только видит.
 */
export function ChatInfoScreen({ chatId }: ChatInfoScreenProps) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const currentUserId = useCurrentUserId();
  const { chat, failed } = useChat(chatId);

  if (!chat) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        {failed ? (
          <LoadFailed
            message="Не удалось открыть чат"
            onRetry={() => reloadMissing(queryClient, [chatQueryKey(chatId)])}
          />
        ) : (
          <ActivityIndicator accessibilityLabel="Загрузка чата" />
        )}
      </View>
    );
  }

  const title = chatTitle(chat, currentUserId);
  const count = chat.participants.length;
  const username = formatUsername(chat.username, 'group');
  const member = chat.kind === 'group' && isChatMember(chat, currentUserId);

  return (
    <KeyboardAwareScrollView
      style={[styles.flex, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      // Над клавиатурой — поле вместе с ответом под ним.
      bottomOffset={Spacing.six}
    >
      {member ? (
        <GroupAvatarEditor
          chatId={chat.id}
          userId={currentUserId}
          avatarUrl={chat.avatarUrl}
          name={title}
          size={AVATAR_SIZE}
        />
      ) : (
        <Avatar uri={chatAvatarUrl(chat, currentUserId)} name={title} size={AVATAR_SIZE} />
      )}

      <View style={styles.identity}>
        <Text variant="title" style={styles.centeredText}>
          {title}
        </Text>
        {username ? (
          <Text testID="chat-info-username" variant="body" color="textSecondary">
            {username}
          </Text>
        ) : null}
        <Text variant="small" color="textSecondary">
          {`${count} ${plural(count, 'участник', 'участника', 'участников')}`}
        </Text>
      </View>

      {member ? (
        // Ключ — текущее имя: переименовал другой участник — поле показывает его
        // имя, а не старое, которое кнопка «Сохранить» молча вернула бы назад.
        <ChatUsernameForm key={chat.username ?? ''} chatId={chat.id} current={chat.username} />
      ) : null}
    </KeyboardAwareScrollView>
  );
}
