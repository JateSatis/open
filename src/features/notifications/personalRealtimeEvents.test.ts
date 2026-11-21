import type { Session } from '@supabase/supabase-js';
import { QueryObserver } from '@tanstack/react-query';
import { act } from '@testing-library/react-native';

import { subscribeToUserEvents, type IncomingCall, type IncomingMessage } from '@/api/chats';
import { emptyState, useSessionStore } from '@/features/auth/sessionState';
import { channelSubscriptionQueryKey } from '@/features/channels/keys';
import { chatsQueryKey } from '@/features/chats/chatsKey';
import { bindHistoryReader } from '@/features/chats/messages/local/reader';
import { chatQueryKey } from '@/features/chats/useChat';
import { reportDeviceNetwork, reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { friendKeys } from '@/features/friends/keys';
import { popsQueryKey } from '@/features/pops/keys';
import { leaveCall } from '@/features/streams/callSession';
import { getCall } from '@/features/streams/callStore';
import { useIncomingCall } from '@/features/streams/incomingCall';
import { createAppQueryClient, syncQueryOnlineState } from '@/lib/queryClient';
import { setActiveChatId } from '@/store/activeChat';
import { dismissAlert, showNotice, useInAppAlert } from './alertsStore';
import { startPersonalRealtimeEvents } from './personalRealtimeEvents';

jest.mock('@/api/chats', () => ({ subscribeToUserEvents: jest.fn() }));
jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/api/invites', () => ({}));
jest.mock('@/features/streams/callSession', () => ({ leaveCall: jest.fn() }));
jest.mock('@/features/streams/callStore', () => ({ getCall: jest.fn() }));

const subscribe = jest.mocked(subscribeToUserEvents);
const events = () => subscribe.mock.lastCall![1];
const alert = () => useInAppAlert.getState().alert;
const ringing = () => useIncomingCall.getState().ringing;
const message: IncomingMessage = {
  messageId: 'm1', chatId: 'A', authorId: 'sender', authorName: 'Марина',
  messageKind: 'text', text: 'ты где', channel: null, subscribedChatTitle: null, notify: true,
};
const channel = { id: 'channel', title: 'Плейлисты', avatarUrl: null };
const pop = { channel, chatId: 'A', notify: true, popId: 'p1', createdAt: '2026-11-01' };
const call = (): IncomingCall => ({
  chatId: 'A', streamId: 'stream', chatTitle: null, chatKind: 'direct',
  hostId: 'sender', hostName: 'Марина', startedAt: new Date().toISOString(),
});
let client: ReturnType<typeof createAppQueryClient>;
const stops: (() => void)[] = [];
const disconnect = jest.fn();

function confirm(userId: string) {
  useSessionStore.setState({
    localAccountId: userId, sdkStatus: 'session', session: { user: { id: userId } } as Session,
  });
}

function start(reader = 'user-1', cache = client) {
  stops.push(startPersonalRealtimeEvents(reader, cache));
}

beforeEach(() => {
  jest.clearAllMocks();
  subscribe.mockReturnValue(disconnect);
  client = createAppQueryClient('user-1');
  client.setDefaultOptions({ queries: { gcTime: Infinity } });
  confirm('user-1');
  bindHistoryReader(() => useSessionStore.getState().localAccountId ?? null);
});

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  client.clear();
  setActiveChatId(null);
  useSessionStore.setState(emptyState);
  bindHistoryReader(() => null);
});

it('ждёт подтверждения SDK и сохраняет подписку при обновлении токена и смене чата', () => {
  useSessionStore.setState({ sdkStatus: 'offline' });
  start();
  showNotice('Сохранено');
  expect(subscribe).not.toHaveBeenCalled();
  confirm('user-1');
  expect(alert()).toMatchObject({ text: 'Сохранено' });
  dismissAlert();
  useSessionStore.setState({ session: { ...useSessionStore.getState().session!, access_token: 'new' } });
  setActiveChatId('A');
  setActiveChatId('B');
  client.setQueryData(chatQueryKey('B'), {});
  client.setQueryData(chatsQueryKey, []);
  events().onMessage({ ...message, chatId: 'B' });
  expect(client.getQueryState(chatQueryKey('B'))?.isInvalidated).toBe(true);
  expect(client.getQueryState(chatsQueryKey)?.isInvalidated).toBe(true);
  expect(alert()).toBeNull();
  events().onMessage(message);
  expect(alert()).toEqual({ kind: 'message', ...message });
  expect(subscribe).toHaveBeenCalledTimes(1);
  expect(disconnect).not.toHaveBeenCalled();
});

it('обновляет подписки и попсы даже при отключённых карточках', () => {
  start();
  client.setQueryData(channelSubscriptionQueryKey(channel.id), {});
  client.setQueryData(popsQueryKey(channel.id), []);
  events().onMessage({ ...message, subscribedChatTitle: 'Аня и Пётр', notify: false });
  events().onMessage({ ...message, channel, notify: false });
  events().onMessage({ ...message, messageKind: 'system' });
  events().onPop?.({ ...pop, notify: false });
  expect(client.getQueryState(channelSubscriptionQueryKey(channel.id))?.isInvalidated).toBe(true);
  expect(client.getQueryState(popsQueryKey(channel.id))?.isInvalidated).toBe(true);
  expect(alert()).toBeNull();
  setActiveChatId('A');
  events().onPop?.(pop);
  expect(alert()).toBeNull();
  setActiveChatId('B');
  events().onPop?.(pop);
  expect(alert()).toEqual({ kind: 'pop', ...pop });
});

it('обновляет кеш при изменении дружбы без карточки', () => {
  const keys = [friendKeys.summary('user-1'), chatsQueryKey, ['messages', 'A']];
  for (const queryKey of keys) client.setQueryData(queryKey, {});
  start();
  events().onFriendsChanged?.();
  for (const queryKey of keys) expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
  expect(alert()).toBeNull();
});

it('передаёт звонок и завершение и выходит при потере членства в активном звонке', () => {
  start();
  const incoming = call();
  events().onIncomingCall?.(incoming);
  expect(ringing()).toEqual(incoming);
  events().onStreamEnded?.(incoming.streamId, incoming.chatId);
  expect(ringing()).toBeNull();
  jest.mocked(getCall).mockReturnValue({ chatId: 'A' } as NonNullable<ReturnType<typeof getCall>>);
  events().onMembershipEnded?.('B');
  expect(leaveCall).not.toHaveBeenCalled();
  events().onMembershipEnded?.('A');
  expect(leaveCall).toHaveBeenCalledTimes(1);
  jest.mocked(getCall).mockReset();
});

it('при смене владельца очищает карточку и звонок, запоздалые события не затрагивают новый сеанс', () => {
  start();
  const old = events();
  old.onMessage(message);
  old.onIncomingCall?.(call());
  expect(alert()).not.toBeNull();
  expect(ringing()).not.toBeNull();
  confirm('user-2');
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(alert()).toBeNull();
  expect(ringing()).toBeNull();
  const next = createAppQueryClient('user-2');
  start('user-2', next);
  const incoming = call();
  events().onIncomingCall?.(incoming);
  const oldCache = jest.spyOn(client, 'invalidateQueries');
  const newCache = jest.spyOn(next, 'invalidateQueries');
  jest.mocked(getCall).mockClear();
  old.onMessage(message);
  old.onJoined?.(true);
  old.onStreamEnded?.(incoming.streamId, incoming.chatId);
  old.onIncomingCall?.({ ...incoming, streamId: 'old' });
  old.onMembershipEnded?.(incoming.chatId);
  expect(oldCache).not.toHaveBeenCalled();
  expect(newCache).not.toHaveBeenCalled();
  expect(alert()).toBeNull();
  expect(ringing()).toEqual(incoming);
  expect(getCall).not.toHaveBeenCalled();
  expect(leaveCall).not.toHaveBeenCalled();
  useSessionStore.setState({ localAccountId: null, sdkStatus: 'signedOut', session: null });
  expect(disconnect).toHaveBeenCalledTimes(2);
  expect(ringing()).toBeNull();
  next.clear();
});

it('один раз обновляет чаты при возврате сети и догоняет отдельный обрыв персонального канала', async () => {
  reportRealtimeJoined();
  start();
  const stop = syncQueryOnlineState(client, true);
  let serverRows = ['первый снимок'];
  const load = jest.fn(async () => serverRows);
  const observer = new QueryObserver(client, {
    queryKey: chatsQueryKey, queryFn: load, initialData: ['локальный'], staleTime: Infinity,
    gcTime: Infinity, meta: { refreshOnUserChannelJoin: true },
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    await act(() => events().onJoined?.(false));
    expect(load).toHaveBeenCalledTimes(1);
    await act(() => reportDeviceNetwork(false));
    await act(() => reportDeviceNetwork(true));
    await act(() => reportRealtimeJoined());
    expect(load).toHaveBeenCalledTimes(1);
    serverRows = ['сообщение до переподписки'];
    await act(() => events().onJoined?.(true));
    expect(load).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(chatsQueryKey)).toEqual(serverRows);
    events().onDisconnected?.();
    // Переподписка без системного разрыва может означать пропущенные сообщения.
    await act(() => events().onJoined?.(true));
    expect(load).toHaveBeenCalledTimes(3);
  } finally {
    unsubscribe();
    stop();
    resetConnectionState();
  }
});
