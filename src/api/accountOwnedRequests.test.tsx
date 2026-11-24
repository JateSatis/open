import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { RequestClientContext } from '@/features/auth/RequestClientContext';
import { getCall, setCall } from '@/features/streams/callStore';
import { addSession, getAccounts, selectAccount, signOutAccount } from '@/features/auth/sessionStore';
import { sendPost } from '@/features/chats/messages/delivery';
import { resetOutbox } from '@/features/chats/messages/outbox';
import { useMyProfile } from '@/features/profile/queries';
import { profileKeys } from '@/features/profile/keys';
import { sessionOf } from '@/test/sessionOf';
import { sessionIdOf } from '@/lib/jwt';
import { acquireChatTopic } from './chatTopics';
import { requestClient } from './requestClient';
import { createSignedUrlStore } from './signedUrls';
import { uploadMedia } from '@/features/media/storage';

jest.mock('@/features/media/mediaLibrary', () => ({}));
jest.mock('react-native-compressor', () => ({}));
jest.mock('@/features/media', () => ({
  ...jest.requireActual('@/features/media/storage'),
  ...jest.requireActual('@/features/media/uploadAll'),
  ...jest.requireActual('@/features/media/photoEdits/outgoing'),
}));
jest.mock('expo-file-system', () => ({
  ...jest.requireActual('expo-file-system'),
  File: class {
    exists = true;
    async arrayBuffer() { return new ArrayBuffer(8); }
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function session(user: string, id: string) {
  return { ...sessionOf(user, id), expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'refresh-' + id };
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

const wire: { path: string; session: string | null }[] = [];
const authorizations: (string | null)[] = [];
let respond: (path: string, id: string | null) => Promise<Response> | Response;

beforeEach(async () => {
  respond = () => json(null);
  wire.length = 0;
  authorizations.length = 0;
  jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname;
    const auth = new Headers(init?.headers).get('Authorization');
    authorizations.push(auth);
    const id = sessionIdOf(auth?.slice(7) ?? '');
    wire.push({ path, session: id });
    return respond(path, id);
  });
  await addSession(session('A', 'a1'));
  await addSession(session('B', 'b1'));
  await selectAccount('A');
});

afterEach(async () => {
  jest.useRealTimers();
  resetOutbox();
  respond = () => json({});
  for (const user of getAccounts()) await signOutAccount(user);
  jest.restoreAllMocks();
});

it('retry запроса экрана A читает через A и заполняет только его QueryClient', async () => {
  const first = deferred<Response>();
  const a = requestClient();
  const rpcA = jest.spyOn(a, 'rpc');
  respond = (_path, id) => id === 'a1' && rpcA.mock.calls.length === 1
    ? first.promise : json([{ id: id === 'b1' ? 'B' : 'A', display_name: id }]);

  const open = (client: QueryClient, api = requestClient()) => renderHook(useMyProfile, {
    wrapper: ({ children }: PropsWithChildren) => (
      <RequestClientContext.Provider value={api}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </RequestClientContext.Provider>
    ),
  });
  const cacheA = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0 } } });
  const screenA = await open(cacheA);
  await waitFor(() => expect(wire).toContainEqual({ path: '/rest/v1/rpc/profile_cards', session: 'a1' }));

  await selectAccount('B');
  const rpcB = jest.spyOn(requestClient(), 'rpc');
  const cacheB = new QueryClient();
  const screenB = await open(cacheB);
  await waitFor(() => expect(cacheB.getQueryData(profileKeys.me())).toMatchObject({ id: 'B' }));
  first.resolve(json({ message: 'retry' }, 503));
  await waitFor(() => expect(cacheA.getQueryData(profileKeys.me())).toMatchObject({ id: 'A' }));
  expect(cacheB.getQueryData(profileKeys.me())).toMatchObject({ id: 'B' });
  expect(rpcA).toHaveBeenCalledTimes(2);
  expect(rpcB).toHaveBeenCalledTimes(1);
  expect(wire.map(request => request.session)).toEqual(['a1', 'b1', 'a1']);
  await screenA.unmount();
  await screenB.unmount();
  cacheA.clear();
  cacheB.clear();
});

it('после выбора B берёт обновлённый токен исходного сеанса A', async () => {
  const a = requestClient();
  await selectAccount('B');
  const refreshed = { ...session('A', 'a1'), ...sessionOf('A', 'a1', 2) };
  jest.spyOn(a.auth, 'getSession').mockResolvedValue({ data: { session: refreshed }, error: null });
  const { error } = await a.rpc('my_chat_list');
  expect(error).toBeNull();
  expect(authorizations.at(-1)).toBe('Bearer ' + refreshed.access_token);
});

it('завершает отправку вложения через исходный клиент после выбора B', async () => {
  const sanitized = deferred<Response>();
  respond = path => {
    if (path.endsWith('/sanitize-media')) return sanitized.promise;
    if (path.endsWith('/send_media_message')) return json('sent');
    if (path.endsWith('/message_rows')) return json({ id: 'sent', chat_id: 'chat', kind: 'media', seq: 1 });
    return json({ Key: 'uploaded' });
  };
  const a = requestClient();
  const rpcA = jest.spyOn(a, 'rpc');
  const file = { uri: 'file:///test.jpg', width: 24, height: 16 };
  const cache = new QueryClient();
  sendPost({ queryClient: cache, chatId: 'chat', currentUserId: 'A' }, 'attachment', [{
    id: 'photo', kind: 'photo', width: 24, height: 16, durationMs: null,
    edited: { file: () => file, prepare: async () => file },
  }]);
  await waitFor(() => expect(wire.some(row => row.path.endsWith('/sanitize-media'))).toBe(true));
  await selectAccount('B');
  resetOutbox();
  const rpcB = jest.spyOn(requestClient(), 'rpc');
  sanitized.resolve(json({ path: 'A/photo', url: 'A/photo', size_bytes: 8 }));
  await waitFor(() => expect(wire.some(row => row.path.endsWith('/message_rows'))).toBe(true));
  expect(rpcA.mock.calls.map(call => call[0])).toEqual(['send_media_message']);
  expect(rpcB).not.toHaveBeenCalled();
  expect(wire.every(row => row.session === 'a1')).toBe(true);
  cache.clear();
});

it('после выхода и повторного входа в A старый клиент не загружает превью', async () => {
  const main = deferred<Response>();
  respond = path => path.endsWith('/sanitize-media') ? main.promise : json({});
  const old = requestClient();
  const pending = uploadMedia({
    uri: 'file:///video', posterUri: 'file:///poster', kind: 'video', width: 1, height: 1,
    mimeType: 'video/mp4', durationMs: 1000,
  }, 'A', old);
  await waitFor(() => expect(wire.some(row => row.path.endsWith('/sanitize-media'))).toBe(true));
  await signOutAccount('A');
  await addSession(session('A', 'a2'));
  expect(requestClient()).not.toBe(old);
  const count = wire.length;
  main.resolve(json({ path: 'A/main', url: 'A/main', size_bytes: 8 }));
  await expect(pending).rejects.toThrow();
  expect(wire).toHaveLength(count);
});

it('разделяет пачки и кеш подписей одного пути', async () => {
  const store = createSignedUrlStore('avatars', { ttlS: 120, refreshBeforeMs: 1000, retryAfterMs: 1000 });
  respond = (_path, id) => json([{ path: 'same', signedURL: '/signed/' + id }]);
  const a = store.sign('same');
  await selectAccount('B');
  const b = store.sign('same');
  expect(await a).toContain('a1');
  expect(await b).toContain('b1');
  expect(store.signed('same')).toContain('b1');
  expect(wire.map(row => row.session).sort()).toEqual(['a1', 'b1']);
});

it('позднее событие и release A не меняют кеш и состояние звонка B в том же топике', async () => {
  jest.useFakeTimers();
  function topicClient() {
    const api = requestClient();
    const handlers = new Map<string, () => void>();
    const channel = {
      on: (_type: string, filter: { event: string }, cb: () => void) => {
        handlers.set(filter.event, cb);
        return channel;
      },
      subscribe: () => channel,
    };
    jest.spyOn(api.realtime, 'setAuth').mockResolvedValue();
    jest.spyOn(api, 'channel').mockReturnValue(channel as unknown as RealtimeChannel);
    const remove = jest.spyOn(api, 'removeChannel').mockResolvedValue('ok');
    return { handlers, channel, remove };
  }
  const a = topicClient();
  const cacheB = new QueryClient();
  const call = { current: 'B' };
  const subA = acquireChatTopic('same', { onStreamChanged: () => setCall(null) });
  await selectAccount('B');
  const b = topicClient();
  setCall({ streamId: 'B', chatId: 'same', chatTitle: 'B', role: 'speaker', connection: 'connected',
    micOn: true, speakerOn: false, speakers: [], listeners: 0, joinedAt: Date.now() });
  const subB = acquireChatTopic('same', { onMessage: () => cacheB.setQueryData(['chat'], 'B') });
  a.handlers.get('stream_changed')!();
  subA.release();
  await jest.advanceTimersByTimeAsync(3000);
  b.handlers.get('new_message')!();
  expect(a.remove).toHaveBeenCalledWith(a.channel);
  expect(b.remove).not.toHaveBeenCalled();
  expect(cacheB.getQueryData(['chat'])).toBe('B');
  expect(getCall()?.streamId).toBe('B');
  setCall(null);
  subB.release();
  await jest.advanceTimersByTimeAsync(3000);
  cacheB.clear();
});
