import { Pressable, View } from 'react-native';

import { styles } from './styles';

import type { Message } from '@/api/chats';
import type { ChatInvite } from '@/api/invites';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { formatChatTimestamp, listNames } from '@/features/chats/chatDisplay';
import { useTheme } from '@/hooks/use-theme';

export type InviteCardProps = {
  invite: ChatInvite;
  currentUserId: string | null;
  /** Какой ответ на эту заявку уходит прямо сейчас. */
  responding: 'accept' | 'decline' | null;
  onOpen: (chatId: string) => void;
  onAccept: (chatId: string) => void;
  onDecline: (chatId: string) => void;
  /** Тап по позвавшему — его профиль. */
  onOpenPerson?: (userId: string) => void;
};

function previewText(message: Message): string {
  if (message.text) return message.text;
  if (message.kind === 'photo') return 'Фото';
  if (message.kind === 'video') return 'Видео';
  if (message.kind === 'media') return 'Медиа';
  if (message.kind === 'voice') return 'Голосовое';
  if (message.kind === 'forward') return 'Пересланные сообщения';

  return 'Вложение';
}

/**
 * Заявка целиком: кто зовёт, кто в чате, о чём там говорят. Решение можно
 * принять, не открывая переписку, а можно открыть и прочитать — чат публичный.
 */
export function InviteCard({
  invite,
  currentUserId,
  responding,
  onOpen,
  onAccept,
  onDecline,
  onOpenPerson,
}: InviteCardProps) {
  const theme = useTheme();
  const { chat, inviter } = invite;
  const inviterName = inviter?.displayName ?? 'Удалённый аккаунт';
  const authors = new Map(chat.participants.map((person) => [person.id, person.displayName]));
  const others = chat.waiting.filter((person) => person.id !== currentUserId);
  // Старые сверху: так карточка читается как кусок переписки.
  const messages = [...invite.recentMessages].reverse();

  return (
    <View style={[styles.card, { borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Открыть чат: ${chat.title ?? inviterName}`}
        onPress={() => onOpen(invite.chatId)}
        style={styles.body}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Профиль: ${inviterName}`}
            disabled={!inviter || !onOpenPerson}
            onPress={() => inviter && onOpenPerson?.(inviter.id)}
            hitSlop={4}
          >
            <Avatar uri={inviter?.avatarUrl} name={inviterName} />
          </Pressable>
          <View style={styles.headerText}>
            <Text variant="bodyBold" numberOfLines={1}>
              {chat.title ?? inviterName}
            </Text>
            <Text variant="caption" color="textSecondary" numberOfLines={1}>
              {chat.kind === 'group'
                ? `${inviterName} зовёт вас в группу`
                : `${inviterName} зовёт вас в диалог`}
            </Text>
          </View>
          <Text variant="caption" color="textSecondary">
            {formatChatTimestamp(invite.invitedAt)}
          </Text>
        </View>

        {chat.kind === 'group' ? (
          <Text variant="small" color="textSecondary" numberOfLines={2}>
            {`В чате: ${listNames(chat.participants)}`}
            {others.length > 0 ? `\nТоже позваны: ${listNames(others)}` : ''}
          </Text>
        ) : null}

        {messages.length > 0 ? (
          <View style={[styles.preview, { borderLeftColor: theme.border }]}>
            {messages.map((message) => (
              <Text key={message.id} variant="small" numberOfLines={2}>
                <Text variant="smallBold">
                  {(message.authorId && authors.get(message.authorId)) ?? 'Удалённый аккаунт'}:{' '}
                </Text>
                {previewText(message)}
              </Text>
            ))}
          </View>
        ) : (
          <Text variant="small" color="textSecondary">
            Сообщений пока нет
          </Text>
        )}
      </Pressable>

      <View style={styles.actions}>
        {invite.status === 'pending' ? (
          <Button
            label="Отклонить"
            variant="secondary"
            size="md"
            loading={responding === 'decline'}
            disabled={responding !== null}
            onPress={() => onDecline(invite.chatId)}
            style={styles.action}
          />
        ) : null}
        <Button
          label="Принять"
          size="md"
          loading={responding === 'accept'}
          disabled={responding !== null}
          onPress={() => onAccept(invite.chatId)}
          style={styles.action}
        />
      </View>
    </View>
  );
}
