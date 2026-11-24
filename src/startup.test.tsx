import { requestClient } from '@/api/requestClient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { onlineManager, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SplashScreen from 'expo-splash-screen';
import { Linking, Text } from 'react-native';

import { readAccounts, type Accounts } from '@/features/auth/accountStorage';
import { getMyPrivacySettings } from '@/api/privacy';
import { listChats, subscribeToUserEvents } from '@/api/chats';
import { stillReader, useHistoryReader } from '@/features/chats/messages/local/reader';
import { useChats } from '@/features/chats/useChats';
import { startConnectionMonitor } from '@/features/connection/connectionMonitor';
import { reportDeviceNetwork, reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { navigationRef, router, useRouter } from '@/navigation';
import { createAppQueryClient } from '@/lib/queryClient';
import { getActiveChatId, setActiveChatId } from '@/store/activeChat';
import { getMediaSheetPhase, openMediaSheet } from '@/features/chats/MediaPickerSheet/sheetStore';
import { confirm } from '@/components/ConfirmDialog/store';
import { addSession, selectAccount, signOutAccount } from '@/features/auth/sessionStore';
import { useRequestClient } from '@/features/auth/RequestClientContext';
import { setDraftText, useChatDraft } from '@/features/chats/composerDraftStore';
import { startDeviceLifecycle } from '@/features/auth/deviceLifecycle';
import { sessionOf } from '@/test/sessionOf';
import { App } from './index';

type AuthListener = (event: AuthChangeEvent, session: Session | null) => void;
let mockAuthEvent: AuthListener;
const mockGetSession = jest.fn();
jest.mock('@/api/supabase', () => {
  const sdk = jest.requireActual('@/api/supabase');
  return {
    get supabase() { return sdk.supabase; },
    selectApiClient: sdk.selectApiClient,
    createAccountClient: () => ({
      getChannels: () => [],
      removeAllChannels: jest.fn(),
      realtime: { disconnect: jest.fn() },
      auth: {
        signOut: jest.fn(),
        dispose: jest.fn(),
        getSession: () => mockGetSession(),
        onAuthStateChange: (listener: AuthListener) => {
          mockAuthEvent = listener;
          return { data: { subscription: { unsubscribe: jest.fn() } } };
        },
      },
    }),
  };
});
jest.mock('@/features/auth/accountStorage', () => ({
  ...jest.requireActual('@/features/auth/accountStorage'),
  readAccounts: jest.fn(),
  readAccountSession: jest.fn(async () => null),
  writeAccounts: jest.fn(),
  cleanAccountStorage: jest.fn(async () => {}),
}));
jest.mock('expo', () => ({ ...jest.requireActual('expo'), registerRootComponent: jest.fn() }));
jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn(), setAudioModeAsync: jest.fn() }));
jest.mock('expo-splash-screen', () => ({
  setOptions: jest.fn(),
  preventAutoHideAsync: jest.fn(),
  hideAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/api/privacy', () => ({ getMyPrivacySettings: jest.fn() }));
const mockDisconnect = jest.fn();
jest.mock('@/api/chats', () => ({
  listChats: jest.fn(),
  subscribeToUserEvents: jest.fn(() => mockDisconnect),
}));
jest.mock('@/features/streams/callSession', () => ({ leaveCall: jest.fn() }));
jest.mock('@/lib/queryClient', () => ({
  ...jest.requireActual('@/lib/queryClient'),
  createAppQueryClient: jest.fn((owner, api) => {
    const client = jest.requireActual('@/lib/queryClient').createAppQueryClient(owner, api);
    const options = client.getDefaultOptions();
    client.setDefaultOptions({
      ...options,
      queries: { ...options.queries, gcTime: Infinity },
      mutations: { ...options.mutations, gcTime: Infinity },
    });
    return client;
  }),
}));
jest.mock('@/features/auth/signIn', () => ({ signOutOfGoogle: jest.fn() }));
const mockShellMount = jest.fn();
jest.mock('../modules/scroll-tap', () => {
  const React = require('react');
  const { ScrollTap } = jest.requireActual('../modules/scroll-tap');
  return { ScrollTap: (props: import('react').PropsWithChildren) => {
    React.useEffect(() => { mockShellMount(); }, []);
    return React.createElement(ScrollTap, props);
  } };
});
const mockReadRoute = jest.fn();
jest.mock('@/features/chats/messages/local/database', () => ({
  localHistory: () => ({ route: mockReadRoute }),
}));

// Оставляем настоящий bootstrap, границу кеша, навигацию и запрос списка.
jest.mock('@/features/connection/connectionMonitor', () => ({ startConnectionMonitor: jest.fn() }));
jest.mock('@/features/auth/deviceLifecycle', () => ({ startDeviceLifecycle: jest.fn() }));
jest.mock('@/features/chats/messages/local/readDelivery', () => ({ startHistoryReadDelivery: jest.fn() }));
jest.mock('@/features/recs/journal/lifecycle', () => ({ startJournalLifecycle: jest.fn() }));
jest.mock('@/features/streams/IncomingCallOverlay', () => ({ IncomingCallOverlay: () => null }));
jest.mock('@/navigation/routes/ChatsRoutes', () => {
  const { Stack } = require('@/navigation/routes/rootStack');
  return { chatsRoutes: require('react').createElement(Stack.Screen, { name: 'Chat', component: MockChatDetail }) };
});
jest.mock('@/navigation/routes/FeedRoutes', () => ({ feedRoutes: null }));
jest.mock('@/navigation/routes/ProfileRoutes', () => ({ profileRoutes: null }));
jest.mock('@/features/streams/CallScreen', () => ({ CallScreen: () => null }));
jest.mock('@/features/media/MediaLabScreen', () => ({ MediaLabScreen: () => null }));
jest.mock('@/features/chats/MosaicLabScreen', () => ({ MosaicLabScreen: () => null }));
jest.mock('@/features/feed/FeedScreen', () => ({ FeedScreen: () => null }));
jest.mock('@/features/profile/MyProfileScreen', () => ({ MyProfileScreen: () => null }));
jest.mock('@/features/auth/SignInScreen', () => {
  const { Text } = require('react-native');
  return { SignInScreen: () => <Text>Вход</Text> };
});
jest.mock('@/features/chats/ChatsScreen', () => ({ ChatsScreen: MockChatsScreen }));

function MockChatDetail() {
  return <Text>Переписка {useHistoryReader()}</Text>;
}

const observed = jest.fn();
function MockChatsScreen() {
  const screenRouter = useRouter();
  const reader = useHistoryReader();
  const api = useRequestClient();
  const cache = useQueryClient();
  const draft = useChatDraft('shared').text;
  observed({ reader, api, cache, screenRouter, data: cache.getQueryData(['shared']), draft });
  const { chats } = useChats();
  return <Text>{chats[0]?.title ?? 'Список пуст'}</Text>;
}

const account = sessionOf('reader', 'session-a');
const stored: Accounts = { selected: 'reader', accounts: [{ userId: 'reader', key: 'slot' }] };
const pending = () => new Promise<never>(() => {});
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
  mockGetSession.mockImplementation(pending);
  jest.mocked(readAccounts).mockResolvedValue(stored);
  jest.mocked(getMyPrivacySettings).mockImplementation(pending);
  jest.mocked(listChats).mockImplementation(pending);
  mockReadRoute.mockReturnValue(undefined);
});
afterEach(() => {
  resetConnectionState();
  onlineManager.setOnline(true);
  jest.restoreAllMocks();
});

it('показывает сохранённую строку до ответа SDK, сохраняет экран и кеш при подтверждении и очищает их при выходе', async () => {
  let finishRead!: (value: Accounts) => void;
  jest.mocked(readAccounts).mockReturnValue(
    new Promise((resolve) => {
      finishRead = resolve;
    }),
  );
  await AsyncStorage.setItem('privacy.birthDateKnown.reader', '1');
  mockReadRoute.mockImplementation((userId, key) =>
    userId === 'reader' && key === 'chats' ? [{ title: 'Сохранённый чат' }] : undefined,
  );
  await render(<App />);
  expect(startConnectionMonitor).toHaveBeenCalledTimes(1);
  expect(navigationRef.isReady()).toBe(false);
  expect(createAppQueryClient).not.toHaveBeenCalled();
  expect(screen.queryByText('Вход')).toBeNull();
  await act(() => finishRead(stored));
  const row = await screen.findByText('Сохранённый чат');
  const chats = navigationRef.getCurrentRoute();
  const localClient = jest.mocked(createAppQueryClient).mock.results[0].value;
  localClient.setQueryData(['marker'], 42);
  expect(stillReader('reader')).toBe(true);
  expect(listChats).not.toHaveBeenCalled();
  expect(getMyPrivacySettings).not.toHaveBeenCalled();
  expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
  await fireEvent(row, 'layout', { nativeEvent: { layout: { width: 400, height: 800 } } });
  expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
  expect(subscribeToUserEvents).not.toHaveBeenCalled();

  await act(() => reportDeviceNetwork(false));
  await act(() => reportDeviceNetwork(true));
  await act(() => reportRealtimeJoined());
  expect(onlineManager.isOnline()).toBe(false);
  expect(screen.getByText('Сохранённый чат')).toBe(row);
  expect(listChats).not.toHaveBeenCalled();
  expect(getMyPrivacySettings).not.toHaveBeenCalled();

  await act(() => mockAuthEvent('SIGNED_IN', account));
  await waitFor(() => expect(listChats).toHaveBeenCalledTimes(1));
  expect(getMyPrivacySettings).toHaveBeenCalledTimes(1);
  expect(createAppQueryClient).toHaveBeenCalledTimes(1);
  expect(subscribeToUserEvents).toHaveBeenCalledWith('reader', expect.any(Object), requestClient());
  await act(() => mockAuthEvent('TOKEN_REFRESHED', sessionOf('reader', 'session-a', 2)));
  expect(subscribeToUserEvents).toHaveBeenCalledTimes(1);
  expect(localClient.getQueryData(['marker'])).toBe(42);
  expect(navigationRef.getCurrentRoute()?.key).toBe(chats?.key);
  expect(screen.getByText('Сохранённый чат')).toBe(row);

  setActiveChatId('chat-of-reader');
  openMediaSheet();
  await act(() => mockAuthEvent('SIGNED_OUT', null));
  const signIn = await screen.findByText('Вход');
  expect(screen.queryByText('Сохранённый чат')).toBeNull();
  expect(stillReader('reader')).toBe(false);
  expect(mockDisconnect).toHaveBeenCalledTimes(1);
  expect(startConnectionMonitor).toHaveBeenCalledTimes(1);
  expect(localClient.getQueryData(['marker'])).toBeUndefined();
  expect(getActiveChatId()).toBeNull();
  expect(getMediaSheetPhase()).toBe('closed');
  await fireEvent(signIn, 'layout', { nativeEvent: { layout: { width: 400, height: 800 } } });
  expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
});

it.each([
  [null, 'Дата рождения'],
  [new Date().toISOString().slice(0, 10), 'Регистрация в Open возможна с 13 лет'],
  ['2000-01-01', 'Список пуст'],
] as const)(
  'выбирает экран по локальной дате %s при незавершённом getSession',
  async (date, expected) => {
    if (date) await AsyncStorage.setItem('privacy.birthDate.reader', date);
    await render(<App />);
    expect(await screen.findByText(expected)).toBeTruthy();
    expect(screen.queryByText('Вход')).toBeNull();
    expect(getMyPrivacySettings).not.toHaveBeenCalled();
  },
);

it('показывает вход при пустой локальной сессии до ответа SDK', async () => {
  jest.mocked(readAccounts).mockResolvedValue({ selected: null, accounts: [] });
  await render(<App />);
  expect(await screen.findByText('Вход')).toBeTruthy();
  expect(mockReadRoute).not.toHaveBeenCalled();
});

it('отбрасывает ссылку локального владельца при выходе во время восстановления', async () => {
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue('openger://media-lab');
  await render(<App />);
  expect(await screen.findByText('Дата рождения')).toBeTruthy();
  await act(() => mockAuthEvent('SIGNED_OUT', null));
  expect(await screen.findByText('Вход')).toBeTruthy();
  expect(navigationRef.getCurrentRoute()?.name).toBe('SignIn');
});

it('возвращает к форме, когда сервер уточнил, что дата отсутствует', async () => {
  await AsyncStorage.setItem('privacy.birthDateKnown.reader', '1');
  await render(<App />);
  expect(await screen.findByText('Список пуст')).toBeTruthy();
  jest.mocked(getMyPrivacySettings).mockResolvedValue({
    birthDate: null,
  } as Awaited<ReturnType<typeof getMyPrivacySettings>>);
  await act(() => mockAuthEvent('SIGNED_IN', account));
  expect(await screen.findByText('Дата рождения')).toBeTruthy();
  expect(await AsyncStorage.getItem('privacy.birthDateKnown.reader')).toBeNull();
});

it('App переключает A → B → A, очищает завершённый A и сохраняет экран B при обновлении токена', async () => {
  const b = sessionOf('B', 'session-b');
  for (const reader of ['reader', 'B']) await AsyncStorage.setItem('privacy.birthDateKnown.' + reader, '1');
  await render(<App />);
  await screen.findByText('Список пуст');
  await act(() => mockAuthEvent('SIGNED_IN', account));
  const first = observed.mock.lastCall![0];
  const cacheA: QueryClient = first.cache;
  const root = screen.root;
  const routerA = first.screenRouter;
  let finishMutation!: () => void;
  const lateMutation = cacheA.getMutationCache().build(cacheA, {
    mutationFn: () => new Promise<string>(done => { finishMutation = () => done('поздний ответ A'); }),
    onSuccess: data => { cacheA.setQueryData(['shared'], data); },
  }).execute(undefined);
  await waitFor(() => expect(finishMutation).toBeDefined());
  await act(() => {
    cacheA.setQueryData(['shared'], 'данные A');
    setDraftText('shared', 'черновик A');
    router.push({ name: 'MediaLab' });
  });
  expect(navigationRef.getCurrentRoute()?.name).toBe('MediaLab');
  let question!: Promise<boolean>;
  await act(() => {
    question = confirm({ title: 'Вопрос A', confirmLabel: 'Да', cancelLabel: 'Нет' });
    setActiveChatId('chat-a');
  });
  const oldEvents = jest.mocked(subscribeToUserEvents).mock.lastCall![1];
  observed.mockClear();
  await act(() => addSession(b));
  await screen.findByText('Список пуст');
  await expect(question).resolves.toBe(false);
  expect(getActiveChatId()).toBeNull();
  const second = observed.mock.calls.find(([row]) => row.reader === 'B')![0];
  expect(second).toMatchObject({ api: requestClient(), draft: '', data: undefined });
  const cacheB: QueryClient = second.cache;
  expect(cacheB).not.toBe(cacheA);
  await act(() => routerA.push({ name: 'MediaLab' }));
  expect(navigationRef.getCurrentRoute()?.name).toBe('chats');
  expect(screen.root).toBe(root);
  await act(() => {
    cacheB.setQueryData(['shared'], 'данные B');
    setDraftText('shared', 'черновик B');
    router.push({ name: 'MediaLab' });
  });
  observed.mockClear();
  await act(() => selectAccount('reader'));
  await screen.findByText('Список пуст');
  const restored = observed.mock.calls.find(([row]) => row.reader === 'reader')![0];
  expect(restored.api).toBe(first.api);
  expect(restored.cache).toBe(cacheA);
  expect(restored).toMatchObject({ data: 'данные A', draft: 'черновик A' });
  expect(navigationRef.getCurrentRoute()?.name).toBe('chats');
  expect(screen.root).toBe(root);

  await act(() => selectAccount('B'));
  await screen.findByText('Список пуст');
  const eventsB = jest.mocked(subscribeToUserEvents).mock.lastCall![1];
  const invite = { inviterId: 'sender', chatId: 'from-B', inviterName: 'Борис', chatTitle: 'Чат B' };
  await act(() => {
    oldEvents.onInvite({ ...invite, chatId: 'old', inviterName: 'Старое' });
    eventsB.onInvite(invite);
  });
  expect(screen.queryByLabelText('Заявка в чат от Старое')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Заявка в чат от Борис'));
  await screen.findByText('Переписка B');
  const detail = navigationRef.getCurrentRoute();
  expect(detail?.params).toMatchObject({ chatId: 'from-B' });
  await act(() => signOutAccount('reader'));
  expect(cacheA.getQueryData(['shared'])).toBeUndefined();
  expect(first.api.retired).toBe(true);
  finishMutation();
  await lateMutation;
  expect(cacheA.getQueryData(['shared'])).toBeUndefined();
  await act(() => mockAuthEvent('TOKEN_REFRESHED', sessionOf('B', 'session-b', 2)));
  expect(navigationRef.getCurrentRoute()?.key).toBe(detail?.key);
  expect(cacheB.getQueryData(['shared'])).toBe('данные B');

  observed.mockClear();
  await act(() => addSession(sessionOf('reader', 'new-session')));
  await screen.findByText('Список пуст');
  const next = observed.mock.calls.find(([row]) => row.reader === 'reader')![0];
  expect(next.cache).not.toBe(cacheA);
  expect(next.api).not.toBe(first.api);
  expect(next).toMatchObject({ data: undefined, draft: '' });
  await act(() => selectAccount('B'));
  await screen.findByText('Список пуст');
  expect(observed.mock.lastCall![0].cache).toBe(cacheB);
  expect(observed.mock.lastCall![0]).toMatchObject({ data: 'данные B', draft: 'черновик B' });
  expect(mockShellMount).toHaveBeenCalledTimes(1);
  expect(createAppQueryClient).toHaveBeenCalledTimes(3);
  expect(startConnectionMonitor).toHaveBeenCalledTimes(1);
  expect(startDeviceLifecycle).toHaveBeenCalledTimes(1);
});

it('замена SDK-сеанса с тем же user.id меняет владельца, отзыв возвращает гостевой экран', async () => {
  await AsyncStorage.setItem('privacy.birthDateKnown.reader', '1');
  await render(<App />);
  await screen.findByText('Список пуст');
  await act(() => mockAuthEvent('SIGNED_IN', account));
  const first = observed.mock.lastCall![0];
  await act(() => {
    setDraftText('shared', 'старый сеанс');
    first.cache.setQueryData(['shared'], 'личное');
    router.push({ name: 'MediaLab' });
  });
  observed.mockClear();
  await act(() => mockAuthEvent('SIGNED_IN', sessionOf('reader', 'replacement')));
  await screen.findByText('Список пуст');
  expect(first.api.retired).toBe(true);
  expect(first.cache.getQueryData(['shared'])).toBeUndefined();
  const next = observed.mock.lastCall![0];
  expect(next.cache).not.toBe(first.cache);
  expect(next).toMatchObject({ reader: 'reader', api: requestClient(), data: undefined, draft: '' });
  expect(navigationRef.getCurrentRoute()?.name).toBe('chats');
  next.cache.setQueryData(['shared'], 'данные нового сеанса');
  await act(() => mockAuthEvent('SIGNED_OUT', null));
  await screen.findByText('Вход');
  expect(next.cache.getQueryData(['shared'])).toBeUndefined();
  expect(requestClient()).not.toBe(next.api);
});
