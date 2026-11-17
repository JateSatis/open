import type { NavigatorScreenParams } from '@react-navigation/native';
import type { ChannelRouteParams } from '@/features/channels/sectionRequest';
import type { ChatSearchParams } from '@/features/chats/chatSearch/useChatSearch';
import type { PopViewerScreenParams } from '@/features/pops/PopViewerScreen';

export type TabsParams = { feed: undefined; chats: undefined; profile: undefined };
export type ChatOrChannel = { kind: 'chat' | 'channel'; id: string };
export type RootParams = {
  Tabs: NavigatorScreenParams<TabsParams> | undefined;
  SignIn: undefined;
  BirthDate: undefined;
  Call: undefined;
  PopEditor: { channelId: string; from?: string };
  PopViewer: PopViewerScreenParams;
  MediaLab: undefined;
  MosaicLab: undefined;
  ChannelLink: { username: string };
  Channel: { channelId: string } & ChannelRouteParams;
  Chat: { chatId: string; from?: string } & ChatSearchParams;
  NewChat: { with?: string } | undefined;
  NewChannel: undefined;
  Invites: undefined;
  Forward: { from?: string } | undefined;
  Saved: undefined;
  Person: { userId: string };
  Friends: { userId: string };
  MyFriends: undefined;
  Dialogs: { userId: string };
  Request: { userId: string };
  ChannelInfo: { channelId: string };
  EditDetails: { target: ChatOrChannel };
  Subscribers: { target: ChatOrChannel };
  ChatInfo: { chatId: string };
  ChatInvite: { chatId: string };
  EditProfile: undefined;
  Account: undefined;
  Privacy: undefined;
  Blocked: undefined;
};
export type Destination = {
  [N in keyof RootParams]: undefined extends RootParams[N]
    ? { name: N; params?: RootParams[N] }
    : { name: N; params: RootParams[N] };
}[keyof RootParams];
