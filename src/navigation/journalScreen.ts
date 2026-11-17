import type { RootParams, TabsParams } from './types';

const paths = {
  SignIn: 'sign-in',
  BirthDate: 'birth-date',
  Call: 'call',
  PopEditor: 'pop-editor/[channelId]',
  PopViewer: 'pops/[channelId]',
  MediaLab: 'media-lab',
  MosaicLab: 'mosaic-lab',
  ChannelLink: 'c/[username]',
  Channel: 'channel/[channelId]',
  Chat: 'chats/[chatId]',
  NewChat: 'chats/new',
  NewChannel: 'chats/new-channel',
  Invites: 'chats/invites',
  Forward: 'chats/forward',
  Saved: 'chats/saved',
  Person: 'profile/[userId]',
  Friends: 'profile/friends/[userId]',
  MyFriends: 'profile/friends',
  Dialogs: 'profile/dialogs/[userId]',
  Request: 'chats/request/[userId]',
  ChannelInfo: 'chats/channel-info/[channelId]',
  EditDetails: 'chats/channel-edit/[channelId]',
  Subscribers: 'chats/channel-subscribers/[channelId]',
  ChatInfo: 'chats/chat-info/[chatId]',
  ChatInvite: 'chats/chat-invite/[chatId]',
  EditProfile: 'profile/edit',
  Account: 'profile/account',
  Privacy: 'profile/privacy',
  Blocked: 'profile/blocked',
} satisfies Record<Exclude<keyof RootParams, 'Tabs'>, string>;

export function journalScreen(name: string, tab: keyof TabsParams | null, params?: object) {
  if (name === 'feed' || name === 'chats' || name === 'profile') return { screen: name, tab: name };
  const source = (params as { source?: string } | undefined)?.source;
  if (name === 'PopViewer')
    return { screen: source === 'search' ? 'pops/search' : paths.PopViewer, tab: null };
  if (
    (name === 'Subscribers' || name === 'EditDetails') &&
    (params as RootParams['Subscribers'] | undefined)?.target.kind === 'chat'
  ) {
    return {
      screen:
        name === 'Subscribers' ? 'chats/chat-subscribers/[chatId]' : 'chats/chat-edit/[chatId]',
      tab,
    };
  }
  if (!Object.prototype.hasOwnProperty.call(paths, name)) return { screen: name, tab: null };
  const path = paths[name as keyof typeof paths];
  if (tab === 'chats' && (name === 'Person' || name === 'Friends' || name === 'Dialogs'))
    return { screen: path.replace('profile/', 'chats/people/'), tab };
  if (name === 'Channel' && tab === 'chats') return { screen: 'chats/channel/[channelId]', tab };
  return {
    screen: path,
    tab: path.startsWith('chats/') || path.startsWith('profile/') ? tab : null,
  };
}
