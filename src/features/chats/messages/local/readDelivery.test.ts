import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QueryClient } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';
import { advanceHistoryRead } from '@/api/historyRead';
import { emptyState, useSessionStore } from '@/features/auth/sessionState';
import {
  reportDeviceNetwork,
  reportRequestSucceeded,
  resetConnectionState,
} from '@/features/connection/connectionStore';
import { openHistoryDatabase } from '@/test/openHistoryDatabase';
import { sessionOf } from '@/test/sessionOf';
import { chatsQueryKey } from '../../chatsKey';
import { localHistory } from './database';
import { startHistoryReadDelivery } from './readDelivery';
import { bindHistoryReader } from './reader';

jest.mock('./database', () => ({ localHistory: jest.fn() }));
jest.mock('@/api/historyRead', () => ({ advanceHistoryRead: jest.fn() }));

const send = jest.mocked(advanceHistoryRead);
const scope = { reader: 'a', chat: 'chat' };
const early = { seq: 7, position: 1, key: 'first' };
const later = { seq: 7, position: 3, key: 'third' };
const batch = () => jest.advanceTimersByTimeAsync(250);
let directory: string;
let disk: ReturnType<typeof openHistoryDatabase>;
let foreground: (state: AppStateStatus) => void;
let client: QueryClient;
let stop: (() => void) | undefined;

function open() {
  disk = openHistoryDatabase(join(directory, 'history.db'));
  jest.mocked(localHistory).mockReturnValue(disk.storage);
}

function signIn(reader: string) {
  useSessionStore.setState({
    localAccountId: reader,
    session: sessionOf(reader, 'session-' + reader),
    sdkStatus: 'session',
  });
}

function delayedResponse() {
  let resolve!: (point: typeof early) => void;
  let reject!: (error: { code: string }) => void;
  send.mockImplementationOnce(
    () =>
      new Promise((ok, fail) => {
        resolve = ok;
        reject = fail;
      }),
  );
  return { resolve: () => resolve(early), reject: (code: string) => reject({ code }) };
}

beforeEach(() => {
  jest.useFakeTimers();
  directory = mkdtempSync(join(tmpdir(), 'open-read-'));
  open();
  client = new QueryClient();
  send.mockReset().mockImplementation(async (_reader, _chat, point) => point);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    foreground = listener;
    return { remove: jest.fn() };
  });
  bindHistoryReader(() => useSessionStore.getState().localAccountId ?? null);
  stop = startHistoryReadDelivery('a', client);
});

afterEach(() => {
  stop?.();
  disk.native.close();
  rmSync(directory, { recursive: true, force: true });
  useSessionStore.setState(emptyState);
  resetConnectionState();
  bindHistoryReader(() => null);
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it.each(['сессия', 'сеть'])(
  'после перезапуска доставляет запись с диска, когда последней появилась %s',
  async (last) => {
    useSessionStore.setState({
      localAccountId: 'a',
      session: sessionOf('a', 'stored'),
      sdkStatus: 'offline',
    });
    reportDeviceNetwork(false);
    disk.storage.reach(scope, early);
    await batch();
    expect(send).not.toHaveBeenCalled();
    stop?.();
    disk.native.close();
    open();
    stop = startHistoryReadDelivery('a', client);
    const online = () => reportRequestSucceeded();
    const confirmed = () => signIn('a');
    (last === 'сессия' ? online : confirmed)();
    await batch();
    expect(send).not.toHaveBeenCalled();
    (last === 'сессия' ? confirmed : online)();
    await batch();
    expect(send.mock.calls).toEqual([['a', 'chat', { ...early, chat: 'chat' }]]);
    expect(disk.storage.pending('a')).toEqual([]);
  },
);

it('повторяет временную ошибку с задержкой и применяет возвращённую сервером позицию', async () => {
  signIn('a');
  reportRequestSucceeded();
  await batch();
  send.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(later);
  disk.storage.reach(scope, early);
  await batch();
  await jest.advanceTimersByTimeAsync(4999);
  expect(send).toHaveBeenCalledTimes(1);
  expect(disk.storage.pending('a')).toHaveLength(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(send).toHaveBeenCalledTimes(2);
  expect(disk.storage.pending('a')).toHaveLength(0);
  expect(disk.storage.reach(scope, later)).toBe(false);
});

it.each(['22023', '42501'])('снимает отклонённый ключ без повтора (%s)', async (code) => {
  signIn('a');
  reportRequestSucceeded();
  disk.storage.reach(scope, early);
  send.mockRejectedValueOnce({ code });
  await jest.advanceTimersByTimeAsync(6000);
  expect(send).toHaveBeenCalledTimes(1);
  expect(disk.storage.pending('a')).toEqual([]);
  expect(disk.storage.reach(scope, early)).toBe(true);
});

it.each(['успех', '22023', '42501'])(
  'сохраняет следующую отметку при позднем ответе (%s)',
  async (result) => {
    signIn('a');
    reportRequestSucceeded();
    disk.storage.reach(scope, early);
    const response = delayedResponse();
    await batch();
    disk.storage.reach(scope, later);
    foreground('active');
    reportDeviceNetwork(false);
    reportRequestSucceeded();
    await batch();
    expect(send).toHaveBeenCalledTimes(1);
    if (result === 'успех') response.resolve();
    else response.reject(result);
    await Promise.resolve();
    expect(disk.storage.pending('a')).toEqual([{ ...later, chat: 'chat' }]);
    await batch();
    expect(send.mock.calls[1]).toEqual(['a', 'chat', { ...later, chat: 'chat' }]);
    expect(disk.storage.pending('a')).toEqual([]);
  },
);

it.each(['успех', '42501'])(
  'после смены владельца игнорирует ответ старой сессии (%s)',
  async (result) => {
    signIn('a');
    reportRequestSucceeded();
    disk.storage.reach(scope, early);
    const response = delayedResponse();
    await batch();
    const other = { reader: 'b', chat: 'chat' };
    disk.storage.reach(other, early);
    signIn('b');
    stop?.();
    const nextClient = new QueryClient();
    const oldRefresh = jest.spyOn(client, 'invalidateQueries');
    const newRefresh = jest.spyOn(nextClient, 'invalidateQueries');
    stop = startHistoryReadDelivery('b', nextClient);
    if (result === 'успех') response.resolve();
    else response.reject(result);
    await Promise.resolve();
    expect(disk.storage.pending('a')).toHaveLength(1);
    expect(disk.storage.pending('b')).toHaveLength(1);
    expect(oldRefresh).not.toHaveBeenCalled();
    expect(newRefresh).not.toHaveBeenCalled();
    await batch();
    expect(send).toHaveBeenLastCalledWith('b', 'chat', { ...early, chat: 'chat' });
    expect(disk.storage.pending('a')).toHaveLength(1);
    expect(disk.storage.pending('b')).toHaveLength(0);
    expect(newRefresh).toHaveBeenCalledWith({ queryKey: chatsQueryKey });
  },
);
