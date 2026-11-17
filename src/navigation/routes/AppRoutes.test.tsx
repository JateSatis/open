import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { DeviceEventEmitter, Linking } from 'react-native';

import { ReturnToCallBar } from '@/features/streams/ReturnToCallBar';
import { setCall } from '@/features/streams/callStore';
import { AppRoutes } from './AppRoutes';
import { navigationRef, router } from '@/navigation';
import { journalScreen } from '../journalScreen';
import { destinationForURL } from '../links';
import { useIncomingLink } from '../useIncomingLink';
import { openPopViewer } from '@/features/pops/openPopViewer';

let mockAccount: string | null = 'reader';
let mockLoading = false;
let mockDate: 'ok' | 'required' = 'ok';
jest.mock('@/features/auth/useSession', () => ({
  useSession: () => ({
    session: mockAccount ? { user: { id: mockAccount } } : null,
    isLoading: mockLoading,
    isAuthenticated: !!mockAccount,
  }),
}));
jest.mock('@/features/auth/sessionStore', () => ({
  useSessionStore: {
    subscribe: () => () => {},
    getState: () => ({ session: mockAccount ? { user: { id: mockAccount } } : null }),
  },
}));
jest.mock('@/features/privacy/queries', () => ({ useBirthDateGate: () => mockDate }));
jest.mock('@/features/connection/ConnectionTitle', () => ({ ConnectionTitle: () => null }));
jest.mock('@/features/feed/FeedScreen', () => ({ FeedScreen: () => null }));
jest.mock('@/features/chats/ChatsScreen', () => ({ ChatsScreen: () => null }));
jest.mock('@/features/profile/MyProfileScreen', () => ({ MyProfileScreen: () => null }));
jest.mock('@/features/auth/AccountScreen', () => ({ AccountScreen: () => null }));
jest.mock('@/features/moderation/BlockedUsersScreen', () => ({ BlockedUsersScreen: () => null }));
jest.mock('@/features/streams/CallScreen', () => ({ CallScreen: () => null }));
jest.mock('@/features/channels/ChannelInfoScreen', () => ({ ChannelInfoScreen: () => null }));
jest.mock('@/features/channels/ChannelScreen', () => ({ ChannelScreen: () => null }));
jest.mock('@/features/channels/SubscribersScreen', () => ({ SubscribersScreen: () => null }));
jest.mock('@/features/chats/EditDetailsScreen', () => ({ EditDetailsScreen: () => null }));
jest.mock('@/features/chats/ChatInfoScreen', () => ({ ChatInfoScreen: () => null }));
jest.mock('@/features/chats/ChatInviteScreen', () => ({ ChatInviteScreen: () => null }));
jest.mock('@/features/chats/ChatScreen', () => ({ ChatScreen: () => null }));
jest.mock('@/features/profile/UserChats', () => ({ UserChats: () => null }));
jest.mock('@/features/profile/EditProfileScreen', () => ({ EditProfileScreen: () => null }));
jest.mock('@/features/chats/ForwardScreen', () => ({ ForwardScreen: () => null }));
jest.mock('@/features/friends/FriendsList', () => ({ FriendsList: () => null }));
jest.mock('@/features/chats/InvitesScreen', () => ({ InvitesScreen: () => null }));
jest.mock('@/features/friends/MyFriendsScreen', () => ({ MyFriendsScreen: () => null }));
jest.mock('@/features/channels/NewChannelForm', () => ({ NewChannelForm: () => null }));
jest.mock('@/features/chats/NewChatScreen', () => ({ NewChatScreen: () => null }));
jest.mock('@/features/profile/UserProfile', () => ({ UserProfile: () => null }));
jest.mock('@/features/pops/PopEditor', () => ({ PopEditor: () => null }));
jest.mock('@/features/pops/PopViewerScreen', () => ({ PopViewerScreen: () => null }));
jest.mock('@/features/privacy/PrivacyScreen', () => ({ PrivacyScreen: () => null }));
jest.mock('@/features/chats/DialogueRequestScreen', () => ({ DialogueRequestScreen: () => null }));
jest.mock('@/features/saved/SavedScreen', () => ({ SavedScreen: () => null }));
jest.mock('@/features/auth/SignInScreen', () => ({ SignInScreen: () => null }));
jest.mock('@/features/media/MediaLabScreen', () => ({ MediaLabScreen: () => null }));
jest.mock('@/features/chats/MosaicLabScreen', () => ({ MosaicLabScreen: () => null }));
jest.mock('@/features/privacy/BirthDateScreen', () => ({ BirthDateScreen: () => null }));
jest.mock('@/features/channels/ChannelLinkScreen', () => {
  const { Redirect, useRouteParams } = require('@/navigation');
  return {
    ChannelLinkScreen: () => (
      <Redirect href={{ name: 'Channel', params: { channelId: useRouteParams().username } }} />
    ),
  };
});

function Harness() {
  const incoming = useIncomingLink();
  return (
    <>
      <ReturnToCallBar />
      <AppRoutes key={mockAccount ?? 'signed-out'} incoming={incoming} />
    </>
  );
}

let sendURL: (url: string) => void;
const current = () => navigationRef.getCurrentRoute();
const names = () => navigationRef.getRootState()?.routes.map((r) => r.name);
const step = async (fn: () => void) => {
  await act(fn);
};
const back = () => step(router.back);
async function start(url: string | null = null) {
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(url);
  return render(<Harness />);
}

beforeEach(() => {
  mockAccount = 'reader';
  mockLoading = false;
  mockDate = 'ok';
  jest.spyOn(Linking, 'addEventListener').mockImplementation((_type, listener) => {
    sendURL = (url) => DeviceEventEmitter.emit('test-url', { url });
    return DeviceEventEmitter.addListener('test-url', listener);
  });
});
afterEach(() => {
  setCall(null);
  jest.restoreAllMocks();
});

it('profile в†’ friends в†’ person в†’ write: Back restores the same entries and tab', async () => {
  await start();
  expect(current()?.name).toBe('chats');
  await step(() => router.navigate({ name: 'Tabs', params: { screen: 'profile' } }));
  const profile = current();
  await step(() => router.push({ name: 'MyFriends' }));
  const friends = current();
  await step(() => router.push({ name: 'Person', params: { userId: 'friend' } }));
  const person = current();
  await step(() => router.push({ name: 'NewChat', params: { with: 'friend' } }));
  await step(() => router.replace({ name: 'Chat', params: { chatId: 'pair' } }));
  expect(names()).toEqual(['Tabs', 'MyFriends', 'Person', 'Chat']);
  await back();
  expect(current()?.key).toBe(person?.key);
  await back();
  expect(current()?.key).toBe(friends?.key);
  await back();
  expect(current()?.key).toBe(profile?.key);
  await back();
  expect(current()?.name).toBe('chats');
});

it.each([
  ['channel-subscribers', 'Subscribers', 'channel', 'Channel'],
  ['chat-subscribers', 'Subscribers', 'chat', 'Chat'],
  ['chat-subscribers', 'Subscribers', 'chat', 'ChatInfo'],
  ['channel-edit', 'EditDetails', 'channel', 'ChannelInfo'],
  ['chat-edit', 'EditDetails', 'chat', 'ChatInfo'],
] as const)('%s opens %s for %s and returns to %s', async (path, name, kind, origin) => {
  await start();
  await step(() =>
    router.push(
      origin === 'Channel' || origin === 'ChannelInfo'
        ? { name: origin, params: { channelId: 'one' } }
        : { name: origin, params: { chatId: 'one' } },
    ),
  );
  const previous = current();
  await step(() => sendURL('openger://chats/' + path + '/one'));
  expect(current()).toMatchObject({ name, params: { target: { kind, id: 'one' } } });
  expect(journalScreen(name, 'chats', current()?.params)).toEqual({
    screen: 'chats/' + path + '/[' + kind + 'Id]',
    tab: 'chats',
  });
  await back();
  expect(current()).toEqual(previous);
});

it('a warm channel link replaces only the resolver above the conversation', async () => {
  await start();
  await step(() => router.push({ name: 'Chat', params: { chatId: 'pair', from: 'notification' } }));
  const chat = current();
  await step(() => sendURL('openger://c/news'));
  expect(names()).toEqual(['Tabs', 'Chat', 'Channel']);
  await back();
  expect(current()).toEqual(chat);
});

it('a cold link waits for restoration and opens once after sign-in and date', async () => {
  mockAccount = null;
  mockLoading = true;
  const view = await start('openger://c/news');
  expect(navigationRef.isReady()).toBe(false);
  mockLoading = false;
  await view.rerender(<Harness />);
  expect(current()?.name).toBe('SignIn');
  mockDate = 'required';
  mockAccount = 'reader';
  await view.rerender(<Harness />);
  expect(current()?.name).toBe('BirthDate');
  mockDate = 'ok';
  await view.rerender(<Harness />);
  await waitFor(() => expect(names()).toEqual(['Tabs', 'Channel']));
  expect(current()?.params).toEqual({ channelId: 'news' });
  await back();
  expect(current()?.name).toBe('chats');
  await view.rerender(<Harness />);
  expect(names()).toEqual(['Tabs']);
});

it('cold link with restored session leaves Chats underneath; switching accounts clears history', async () => {
  const view = await start('openger://c/news');
  await waitFor(() => expect(names()).toEqual(['Tabs', 'Channel']));
  mockAccount = 'another';
  await view.rerender(<Harness />);
  expect(names()).toEqual(['Tabs']);
  expect(current()?.name).toBe('chats');
});

it('feed search в†’ pop в†’ channel; back preserves viewer and feed keys', async () => {
  await start();
  await step(() => router.navigate({ name: 'Tabs', params: { screen: 'feed' } }));
  const feed = current();
  await step(() => openPopViewer({ source: 'search', query: 'cats', startId: 'pop' }));
  const viewer = current();
  await step(() => router.push({ name: 'Channel', params: { channelId: 'news' } }));
  expect(names()).toEqual(['Tabs', 'PopViewer', 'Channel']);
  await back();
  expect(current()).toEqual(viewer);
  await back();
  expect(current()?.key).toBe(feed?.key);
});

it('exposes the labs before sign-in and only the date screen when birth date is required', async () => {
  mockAccount = null;
  const view = await start();
  expect(navigationRef.getRootState()?.routeNames).toEqual(['SignIn', 'MediaLab', 'MosaicLab']);
  mockAccount = 'reader';
  mockDate = 'required';
  await view.rerender(<Harness />);
  expect(navigationRef.getRootState()?.routeNames).toEqual(['BirthDate']);
});

it.each(['media-lab', 'mosaic-lab', 'call'])('opens %s outside tabs', async (path) => {
  await start();
  await step(() => sendURL('openger://' + path));
  expect(names()).toEqual(['Tabs', destinationForURL('openger://' + path)?.name]);
  await back();
  expect(current()?.name).toBe('chats');
});

it('normalizes legacy paths without losing section, query or source', () => {
  for (const [left, right] of [
    ['channel/1', 'chats/channel/1'],
    ['chats/people/1', 'profile/1'],
    ['chats/people/friends/1', 'profile/friends/1'],
    ['chats/people/dialogs/1', 'profile/dialogs/1'],
  ])
    expect(destinationForURL('openger://' + left)).toEqual(destinationForURL('openger://' + right));
  expect(destinationForURL('openger://chats/channel/1?section=pops&sectionKey=2')).toEqual({
    name: 'Channel',
    params: { channelId: '1', section: 'pops', sectionKey: '2' },
  });
  expect(destinationForURL('openger://pops/search?q=two+words&start=id')).toEqual({
    name: 'PopViewer',
    params: { source: 'search', query: 'two words', startId: 'id' },
  });
  expect(destinationForURL('openger://pops/channel?start=id&from=list')).toEqual({
    name: 'PopViewer',
    params: { source: 'channel', channelId: 'channel', startId: 'id', entry: 'list' },
  });
});

it('minimizing and returning to the active call restores its conversation on Back', async () => {
  setCall({
    streamId: 's',
    chatId: 'pair',
    chatTitle: 'Pair',
    role: 'listener',
    connection: 'connected',
    micOn: false,
    speakerOn: true,
    speakers: [],
    listeners: 1,
    joinedAt: Date.now(),
  });
  await start();
  await step(() => router.push({ name: 'Chat', params: { chatId: 'pair' } }));
  const chat = current();
  await fireEvent.press(screen.getByTestId('return-to-call'));
  expect(current()?.name).toBe('Call');
  expect(screen.queryByTestId('return-to-call')).toBeNull();
  await back();
  expect(current()).toEqual(chat);
  await fireEvent.press(screen.getByTestId('return-to-call'));
  expect(names()).toEqual(['Tabs', 'Chat', 'Call']);
});
