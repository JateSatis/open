import { AppState, type AppStateStatus } from 'react-native';

import { registerDevice, signOutLocally, touchDevice } from '@/api/account';
import { markSeen } from '@/api/chatInfo';
import { sessionOf } from '@/test/sessionOf';
import { currentDeviceInfo } from './deviceInfo';
import { startDeviceLifecycle } from './deviceLifecycle';
import { signOutOfGoogle } from './signIn';
import { emptyState, useSessionStore } from './sessionState';

jest.mock('@/api/account', () => ({
  ...jest.requireActual('@/api/account'),
  registerDevice: jest.fn(),
  touchDevice: jest.fn(),
  signOutLocally: jest.fn(),
}));
jest.mock('@/api/supabase', () => ({
  supabase: {
    getChannels: jest.fn(() => [{}]),
    removeChannel: jest.fn(),
    auth: { signOut: jest.fn() },
  },
}));
jest.mock('@/api/chatInfo', () => ({ markSeen: jest.fn(async () => {}) }));
jest.mock('./signIn', () => ({ signOutOfGoogle: jest.fn(async () => {}) }));
jest.mock('./installationId', () => ({ getInstallationId: async () => 'install' }));
jest.mock('./deviceInfo', () => ({ currentDeviceInfo: jest.fn() }));

const a = { userId: 'me', sessionId: 'a' };
const info = { installationId: 'install', platform: 'android', model: 'realme', osVersion: '15', appVersion: '1' } as const;
let change: (state: AppStateStatus) => void;
let stop: () => void;
const remove = jest.fn();
const flush = () => jest.advanceTimersByTimeAsync(0);
const initialAppState = AppState.currentState;

function signedIn(id: string, issuedAt = 1, userId = 'me') {
  useSessionStore.setState({
    sdkStatus: 'session', localAccountId: userId, session: sessionOf(userId, id, issuedAt),
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    change = listener;
    return { remove };
  });
  jest.mocked(touchDevice).mockResolvedValue(true);
  jest.mocked(currentDeviceInfo).mockResolvedValue(info);
  jest.mocked(signOutLocally).mockImplementation(async () => {
    useSessionStore.setState({ ...emptyState, localAccountId: null, sdkStatus: 'signedOut' });
  });
  stop = startDeviceLifecycle();
});

afterEach(() => {
  stop();
  useSessionStore.setState(emptyState);
  AppState.currentState = initialAppState;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it.each(['pending', 'offline'] as const)('ждёт подтверждения SDK при %s', async sdkStatus => {
  useSessionStore.setState({ localAccountId: 'me', session: sessionOf('me', 'a'), sdkStatus });
  await flush();
  expect(AppState.addEventListener).not.toHaveBeenCalled();
  expect(touchDevice).not.toHaveBeenCalled();
  expect(registerDevice).not.toHaveBeenCalled();
  expect(markSeen).not.toHaveBeenCalled();
  signedIn('a');
  await flush();
  expect(registerDevice).toHaveBeenCalledWith(info, a);
});

it('регистрирует один раз для пары, включая refresh и смену владельца', async () => {
  signedIn('a');
  await flush();
  signedIn('a', 2);
  await flush();
  expect(registerDevice).toHaveBeenCalledTimes(1);
  expect(touchDevice).toHaveBeenCalledTimes(1);
  expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
  expect(markSeen).toHaveBeenCalledTimes(1);
  signedIn('a', 3, 'other');
  await flush();
  expect(registerDevice).toHaveBeenCalledTimes(2);
  expect(remove).toHaveBeenCalledTimes(1);
});

it('проверяет сеанс при возврате и подтверждает присутствие раз в минуту до ухода в фон', async () => {
  signedIn('a');
  await jest.advanceTimersByTimeAsync(60_000);
  change('background');
  await jest.advanceTimersByTimeAsync(120_000);
  expect(jest.mocked(markSeen).mock.calls).toEqual([[true, a], [true, a], [false, a]]);
  change('active');
  await jest.advanceTimersByTimeAsync(60_000);
  expect(touchDevice).toHaveBeenCalledTimes(2);
  expect(registerDevice).toHaveBeenCalledTimes(1);
  expect(jest.mocked(markSeen).mock.calls.slice(3)).toEqual([[true, a], [true, a]]);
  useSessionStore.setState(emptyState);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(markSeen).toHaveBeenCalledTimes(5);
});

it('не сообщает об активности, если SDK восстановил сеанс в фоне', async () => {
  AppState.currentState = 'background';
  signedIn('a');
  await jest.advanceTimersByTimeAsync(60_000);
  expect(markSeen).not.toHaveBeenCalled();
  change('active');
  expect(markSeen).toHaveBeenCalledWith(true, a);
});

it.each(['вход', 'возврат'])('игнорирует запоздалый отзыв прежнего сеанса (%s)', async phase => {
  if (phase === 'возврат') {
    signedIn('a');
    await flush();
    change('background');
  }
  let finish!: (result: boolean) => void;
  jest.mocked(touchDevice).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  if (phase === 'возврат') change('active');
  else signedIn('a');
  await flush();
  signedIn('b');
  await flush();
  finish(false);
  await flush();
  expect(signOutOfGoogle).not.toHaveBeenCalled();
  expect(signOutLocally).not.toHaveBeenCalled();
  expect(useSessionStore.getState().session).toEqual(sessionOf('me', 'b'));
  expect(registerDevice).toHaveBeenLastCalledWith(info, { ...a, sessionId: 'b' });
});

it('игнорирует свойства устройства, полученные после повторного входа', async () => {
  let finish!: (result: typeof info) => void;
  jest.mocked(currentDeviceInfo).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  signedIn('a');
  await flush();
  signedIn('b');
  finish(info);
  await flush();
  expect(registerDevice).toHaveBeenCalledTimes(1);
  expect(registerDevice).toHaveBeenCalledWith(info, { ...a, sessionId: 'b' });
});

it('выходит локально при отзыве текущего сеанса', async () => {
  jest.mocked(touchDevice).mockResolvedValue(false);
  signedIn('a');
  await flush();
  expect(registerDevice).not.toHaveBeenCalled();
  expect(signOutLocally).toHaveBeenCalledWith(a);
  expect(useSessionStore.getState().sdkStatus).toBe('signedOut');
});

it('сохраняет вход при ошибке сети', async () => {
  jest.mocked(touchDevice).mockRejectedValue(new TypeError('Network request failed'));
  signedIn('a');
  await flush();
  expect(registerDevice).toHaveBeenCalledWith(info, a);
  expect(signOutLocally).not.toHaveBeenCalled();
  expect(useSessionStore.getState().sdkStatus).toBe('session');
});
