import { SLIDE_PAGE } from '@/components/SlidePage/screenOptions';
import { ChannelLinkScreen } from '@/features/channels/ChannelLinkScreen';
import { ChannelScreen } from '@/features/channels/ChannelScreen';
import { ChatScreen } from '@/features/chats/ChatScreen';
import { NewChatScreen } from '@/features/chats/NewChatScreen';
import { NewChannelForm } from '@/features/channels/NewChannelForm';
import { InvitesScreen } from '@/features/chats/InvitesScreen';
import { DialogueRequestScreen } from '@/features/chats/DialogueRequestScreen';
import { ForwardScreen } from '@/features/chats/ForwardScreen';
import { SavedScreen } from '@/features/saved/SavedScreen';
import { ChannelInfoScreen } from '@/features/channels/ChannelInfoScreen';
import { SubscribersScreen } from '@/features/channels/SubscribersScreen';
import { ChatInfoScreen } from '@/features/chats/ChatInfoScreen';
import { EditDetailsScreen } from '@/features/chats/EditDetailsScreen';
import { ChatInviteScreen } from '@/features/chats/ChatInviteScreen';
import { hidden, Stack } from './rootStack';

export const chatsRoutes = (
  <>
    <Stack.Screen name="ChannelLink" component={ChannelLinkScreen} options={hidden} />
    <Stack.Screen name="Channel" component={ChannelScreen} options={SLIDE_PAGE} />
    <Stack.Screen name="Chat" component={ChatScreen} options={SLIDE_PAGE} />
    <Stack.Screen name="NewChat" component={NewChatScreen} options={{ title: 'Новый чат' }} />
    <Stack.Screen name="NewChannel" component={NewChannelForm} options={{ title: 'Новый канал' }} />
    <Stack.Screen name="Invites" component={InvitesScreen} options={{ title: 'Заявки' }} />
    <Stack.Screen name="Request" component={DialogueRequestScreen} options={SLIDE_PAGE} />
    <Stack.Screen name="Forward" component={ForwardScreen} options={{ title: 'Кому переслать' }} />
    <Stack.Screen
      name="Saved"
      component={SavedScreen}
      options={{ title: 'Сохранённые сообщения' }}
    />
    <Stack.Screen name="ChannelInfo" component={ChannelInfoScreen} options={SLIDE_PAGE} />
    <Stack.Screen
      name="Subscribers"
      component={SubscribersScreen}
      options={{ title: 'Подписчики' }}
    />
    <Stack.Screen name="ChatInfo" component={ChatInfoScreen} options={SLIDE_PAGE} />
    <Stack.Screen
      name="EditDetails"
      component={EditDetailsScreen}
      options={{ title: 'Изменить' }}
    />
    <Stack.Screen
      name="ChatInvite"
      component={ChatInviteScreen}
      options={{ title: 'Добавить участников' }}
    />
  </>
);
