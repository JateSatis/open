import { SLIDE_PAGE } from '@/components/SlidePage/screenOptions';
import * as Screens from '@/navigation/screens';
import { hidden, Stack } from './rootStack';

export const chatsRoutes = (
  <>
    <Stack.Screen name="ChannelLink" component={Screens.ChannelLinkRoute} options={hidden} />
    <Stack.Screen name="Channel" component={Screens.ChannelRoute} options={SLIDE_PAGE} />
    <Stack.Screen name="Chat" component={Screens.ChatRoute} options={SLIDE_PAGE} />
    <Stack.Screen
      name="NewChat"
      component={Screens.NewChatRoute}
      options={{ title: 'Новый чат' }}
    />
    <Stack.Screen
      name="NewChannel"
      component={Screens.NewChannelRoute}
      options={{ title: 'Новый канал' }}
    />
    <Stack.Screen name="Invites" component={Screens.InvitesRoute} options={{ title: 'Заявки' }} />
    <Stack.Screen name="Request" component={Screens.RequestRoute} options={SLIDE_PAGE} />
    <Stack.Screen
      name="Forward"
      component={Screens.ForwardRoute}
      options={{ title: 'Кому переслать' }}
    />
    <Stack.Screen
      name="Saved"
      component={Screens.SavedRoute}
      options={{ title: 'Сохранённые сообщения' }}
    />
    <Stack.Screen name="ChannelInfo" component={Screens.ChannelInfoRoute} options={SLIDE_PAGE} />
    <Stack.Screen
      name="ChannelEdit"
      component={Screens.ChannelEditRoute}
      options={{ title: 'Изменить' }}
    />
    <Stack.Screen
      name="ChannelSubscribers"
      component={Screens.ChannelSubscribersRoute}
      options={{ title: 'Подписчики' }}
    />
    <Stack.Screen name="ChatInfo" component={Screens.ChatInfoRoute} options={SLIDE_PAGE} />
    <Stack.Screen
      name="ChatEdit"
      component={Screens.ChatEditRoute}
      options={{ title: 'Изменить' }}
    />
    <Stack.Screen
      name="ChatSubscribers"
      component={Screens.ChatSubscribersRoute}
      options={{ title: 'Подписчики' }}
    />
    <Stack.Screen
      name="ChatInvite"
      component={Screens.ChatInviteRoute}
      options={{ title: 'Добавить участников' }}
    />
  </>
);
