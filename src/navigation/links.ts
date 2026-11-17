import type { Destination } from './types';

type Params = Record<string, string>;
type Link = { path: string; to: (path: Params, query: Params) => Destination };
const links: Link[] = [
  { path: '', to: () => ({ name: 'Tabs', params: { screen: 'chats' } }) },
  { path: 'feed', to: () => ({ name: 'Tabs', params: { screen: 'feed' } }) },
  { path: 'chats', to: () => ({ name: 'Tabs', params: { screen: 'chats' } }) },
  { path: 'profile', to: () => ({ name: 'Tabs', params: { screen: 'profile' } }) },
  {
    path: 'pops/search',
    to: (_, q) => ({
      name: 'PopViewer',
      params: { source: 'search', query: q.q ?? '', startId: q.start ?? '' },
    }),
  },
  { path: 'sign-in', to: () => ({ name: 'SignIn' }) },
  { path: 'birth-date', to: () => ({ name: 'BirthDate' }) },
  { path: 'call', to: () => ({ name: 'Call' }) },
  { path: 'media-lab', to: () => ({ name: 'MediaLab' }) },
  { path: 'mosaic-lab', to: () => ({ name: 'MosaicLab' }) },
  { path: 'chats/new', to: (_, query) => ({ name: 'NewChat', params: query }) },
  { path: 'chats/new-channel', to: () => ({ name: 'NewChannel' }) },
  { path: 'chats/invites', to: () => ({ name: 'Invites' }) },
  { path: 'chats/forward', to: (_, query) => ({ name: 'Forward', params: query }) },
  { path: 'chats/saved', to: () => ({ name: 'Saved' }) },
  { path: 'profile/friends', to: () => ({ name: 'MyFriends' }) },
  { path: 'profile/edit', to: () => ({ name: 'EditProfile' }) },
  { path: 'profile/account', to: () => ({ name: 'Account' }) },
  { path: 'profile/privacy', to: () => ({ name: 'Privacy' }) },
  { path: 'profile/blocked', to: () => ({ name: 'Blocked' }) },
  {
    path: 'pop-editor/:channelId',
    to: (path, query) => ({ name: 'PopEditor', params: { ...query, channelId: path.channelId } }),
  },
  {
    path: 'pops/:channelId',
    to: (path, query) => ({
      name: 'PopViewer',
      params: {
        source: 'channel',
        channelId: path.channelId,
        startId: query.start ?? '',
        entry: query.from,
      },
    }),
  },
  {
    path: 'c/:username',
    to: (path) => ({ name: 'ChannelLink', params: { username: path.username } }),
  },
  {
    path: 'channel/:channelId',
    to: (path, query) => ({ name: 'Channel', params: { ...query, channelId: path.channelId } }),
  },
  {
    path: 'chats/channel/:channelId',
    to: (path, query) => ({ name: 'Channel', params: { ...query, channelId: path.channelId } }),
  },
  {
    path: 'chats/:chatId',
    to: (path, query) => ({ name: 'Chat', params: { ...query, chatId: path.chatId } }),
  },
  { path: 'profile/:userId', to: (path) => ({ name: 'Person', params: { userId: path.userId } }) },
  {
    path: 'chats/people/:userId',
    to: (path) => ({ name: 'Person', params: { userId: path.userId } }),
  },
  {
    path: 'profile/friends/:userId',
    to: (path) => ({ name: 'Friends', params: { userId: path.userId } }),
  },
  {
    path: 'chats/people/friends/:userId',
    to: (path) => ({ name: 'Friends', params: { userId: path.userId } }),
  },
  {
    path: 'profile/dialogs/:userId',
    to: (path) => ({ name: 'Dialogs', params: { userId: path.userId } }),
  },
  {
    path: 'chats/people/dialogs/:userId',
    to: (path) => ({ name: 'Dialogs', params: { userId: path.userId } }),
  },
  {
    path: 'chats/request/:userId',
    to: (path) => ({ name: 'Request', params: { userId: path.userId } }),
  },
  {
    path: 'chats/channel-info/:channelId',
    to: (path) => ({ name: 'ChannelInfo', params: { channelId: path.channelId } }),
  },
  {
    path: 'chats/channel-edit/:channelId',
    to: (path) => ({ name: 'ChannelEdit', params: { channelId: path.channelId } }),
  },
  {
    path: 'chats/channel-subscribers/:channelId',
    to: (path) => ({ name: 'ChannelSubscribers', params: { channelId: path.channelId } }),
  },
  {
    path: 'chats/chat-info/:chatId',
    to: (path) => ({ name: 'ChatInfo', params: { chatId: path.chatId } }),
  },
  {
    path: 'chats/chat-edit/:chatId',
    to: (path) => ({ name: 'ChatEdit', params: { chatId: path.chatId } }),
  },
  {
    path: 'chats/chat-subscribers/:chatId',
    to: (path) => ({ name: 'ChatSubscribers', params: { chatId: path.chatId } }),
  },
  {
    path: 'chats/chat-invite/:chatId',
    to: (path) => ({ name: 'ChatInvite', params: { chatId: path.chatId } }),
  },
];
// Static paths (including pops/search and profile/friends) win over an ID.
export function destinationForURL(url: string): Destination | null {
  const prefix = 'openger://';
  if (!url.startsWith(prefix)) return null;
  const [path, search] = url
    .slice(prefix.length)
    .split('#', 1)[0]
    .split(/\?(.*)/s);
  try {
    const parts = path
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent)
      .filter((part) => part !== '(tabs)' && part !== '(auth)');
    const query = Object.fromEntries(new URLSearchParams(search));
    for (const link of links) {
      const pattern = link.path.split('/').filter(Boolean);
      const params: Params = {};
      if (
        pattern.length === parts.length &&
        pattern.every((part, i) => {
          if (!part.startsWith(':')) return part === parts[i];
          params[part.slice(1)] = parts[i];
          return true;
        })
      )
        return link.to(params, query);
    }
  } catch {
    /* Malformed external URL. */
  }
  return null;
}
