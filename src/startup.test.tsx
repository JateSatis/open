import { requestClient } from '@/api/requestClient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SplashScreen from 'expo-splash-screen';
import { Linking, Text } from 'react-native';

import { readAccounts, type Accounts } from '@/features/auth/accountStorage';
import { getMyPrivacySettings } from '@/api/privacy';
import { listChats, subscribeToUserEvents } from '@/api/chats';
import { stillReader } from '@/features/chats/messages/local/reader';
import { useChats } from '@/features/chats/useChats';
import { startConnectionMonitor } from '@/features/connection/connectionMonitor';
import { reportDeviceNetwork, reportRealtimeJoined, resetConnectionState } from '@/features/connection/connectionStore';
import { navigationRef } from '@/navigation';
import { createAppQueryClient } from '@/lib/queryClient';
import { getActiveChatId, setActiveChatId } from '@/store/activeChat';
import { getMediaSheetPhase, openMediaSheet } from '@/features/chats/MediaPickerSheet/sheetStore';
import { App } from './index';

type AuthListener = (event: AuthChangeEvent, session: Session | null) => void;
let mockAuthEvent: AuthListener;
const mockGetSession = jest.fn();
jest.mock('@/api/supabase', () => ({
  supabase: {},
  selectApiClient: jest.fn(),
  createAccountClient: () => ({
    removeAllChannels: jest.fn(),
    auth: {
      dispose: jest.fn(),
      getSession: () => mockGetSession(),
      onAuthStateChange: (listener: AuthListener) => {
        mockAuthEvent = listener;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
    },
  }),
}));
jest.mock('@/features/auth/accountStorage', () => ({
  readAccounts: jest.fn(),
  readAccountSession: jest.fn(async () => null),
  writeAccounts: jest.fn(),
  cleanAccountStorage: jest.fn(async () => {}),
}));
jest.mock('expo', () => ({ ...jest.requireActual('expo'), registerRootComponent: jest.fn() }));
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
  createAppQueryClient: jest.fn((owner) => {
    const client = jest.requireActual('@/lib/queryClient').createAppQueryClient(owner);
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
jest.mock('@/features/notifications/InAppMessageToast', () => ({ InAppMessageToast: () => null }));
jest.mock('@/navigation/routes/ChatsRoutes', () => ({ chatsRoutes: null }));
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

function MockChatsScreen() {
  const { chats } = useChats();
  return <Text>{chats[0]?.title ?? 'Список пуст'}</Text>;
}

const account = { user: { id: 'reader' } } as Session;
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
  await act(() => mockAuthEvent('TOKEN_REFRESHED', { ...account, access_token: 'refreshed' }));
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
