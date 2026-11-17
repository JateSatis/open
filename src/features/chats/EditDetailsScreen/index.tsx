import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { styles } from './styles';
import { Text } from '@/components/Text';
import { ChannelEditForm } from '@/features/channels/ChannelEditScreen';
import { useChannel } from '@/features/channels/useChannel';
import { ChatEditForm } from '@/features/chats/ChatEditScreen';
import { useChat } from '@/features/chats/useChat';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { useRouteParams } from '@/navigation';

export function EditDetailsScreen() {
  const { target } = useRouteParams<'EditDetails'>();
  return target.kind === 'channel' ? (
    <ChannelDetails id={target.id} />
  ) : (
    <ChatDetails id={target.id} />
  );
}

function ChannelDetails({ id }: { id: string }) {
  const { data: channel } = useChannel(id);
  return (
    <OwnerForm target="channel" object={channel}>
      {channel && <ChannelEditForm channel={channel} />}
    </OwnerForm>
  );
}

function ChatDetails({ id }: { id: string }) {
  const { chat } = useChat(id);
  return (
    <OwnerForm target="chat" object={chat}>
      {chat && <ChatEditForm chat={chat} />}
    </OwnerForm>
  );
}

function OwnerForm({
  target,
  object,
  children,
}: {
  target: 'channel' | 'chat';
  object?: { ownerId: string | null } | null;
  children: ReactNode;
}) {
  const userId = useCurrentUserId();
  if (object?.ownerId && object.ownerId === userId) return children;
  return (
    <View style={styles.centered}>
      {!object ? (
        <ActivityIndicator
          accessibilityLabel={target === 'channel' ? 'Загрузка канала' : 'Загрузка чата'}
        />
      ) : (
        <Text color="textSecondary">
          {target === 'channel'
            ? 'Изменять канал может только его владелец.'
            : 'Изменять группу может только её владелец.'}
        </Text>
      )}
    </View>
  );
}
