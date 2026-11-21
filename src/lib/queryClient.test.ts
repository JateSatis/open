import { ChatGoneError } from '@/api/chatGone';
import { ProfileUnavailableError } from '@/api/profileErrors';
import { reportRequestFailed, reportRequestSucceeded } from '@/features/connection/connectionStore';
import { createAppQueryClient } from './queryClient';
import { emptyState, useSessionStore } from '@/features/auth/sessionState';
import type { Session } from '@supabase/supabase-js';

jest.mock('@/features/connection/connectionStore', () => ({
  reportRequestFailed: jest.fn(),
  reportRequestSucceeded: jest.fn(),
}));

let client: ReturnType<typeof createAppQueryClient>;

beforeEach(() => {
  client = createAppQueryClient();
  jest.clearAllMocks();
});

afterEach(() => {
  client.clear();
});

it('изолирует кеш каждого клиента', () => {
  const other = createAppQueryClient();
  client.setQueryData(['chats'], ['chat-1']);

  expect(client.getQueryData(['chats'])).toEqual(['chat-1']);
  expect(other.getQueryData(['chats'])).toBeUndefined();
});

it('мутация локального клиента требует подтверждения его владельца даже с networkMode always', async () => {
  const scoped = createAppQueryClient('reader');
  const mutationFn = jest.fn().mockResolvedValue('ok');
  const execute = () => scoped.getMutationCache().build(scoped, {
    mutationFn, networkMode: 'always', gcTime: Infinity,
  }).execute(undefined);
  try {
    useSessionStore.setState({ ...emptyState, localAccountId: 'reader' });
    await expect(execute()).rejects.toThrow('активная сессия');
    const confirm = (id: string) => useSessionStore.setState({
      localAccountId: id, session: { user: { id } } as Session, sdkStatus: 'session',
    });
    confirm('other');
    await expect(execute()).rejects.toThrow('активная сессия');
    expect(mutationFn).not.toHaveBeenCalled();
    confirm('reader');
    await expect(execute()).resolves.toBe('ok');
  } finally {
    scoped.clear();
    useSessionStore.setState(emptyState);
  }
});

it('локальное чтение не подтверждает доступность сервера', async () => {
  await client.fetchQuery({
    queryKey: ['local'], networkMode: 'always', meta: { localOnly: true }, queryFn: () => 'ok',
  });
  expect(reportRequestSucceeded).not.toHaveBeenCalled();
});

it('повторяет запрос ровно один раз через 1000 мс', async () => {
  jest.useFakeTimers();
  try {
    const error = new Error('Временный сбой');
    const queryFn = jest.fn().mockRejectedValue(error);
    const result = expect(client.fetchQuery({ queryKey: ['chats'], queryFn })).rejects.toBe(error);

    await jest.advanceTimersByTimeAsync(999);
    expect(queryFn).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await result;
    expect(queryFn).toHaveBeenCalledTimes(2);
  } finally {
    client.clear();
    jest.useRealTimers();
  }
});

it.each([new ChatGoneError('chat-1'), new ProfileUnavailableError()])(
  'сразу завершает запрос с $name',
  async (error) => {
    const queryFn = jest.fn().mockRejectedValue(error);
    await expect(client.fetchQuery({ queryKey: ['detail'], queryFn })).rejects.toBe(error);
    expect(queryFn).toHaveBeenCalledTimes(1);
  },
);

describe.each(['запрос', 'мутация'] as const)('%s и состояние связи', (operation) => {
  function execute(fn: () => Promise<string>) {
    if (operation === 'запрос') {
      return client.fetchQuery({ queryKey: ['chats'], queryFn: fn, retry: false });
    }
    return client.getMutationCache().build(client, { mutationFn: fn, gcTime: Infinity }).execute(undefined);
  }

  it('сообщает об успешной связи', async () => {
    await execute(() => Promise.resolve('ok'));
    expect(reportRequestSucceeded).toHaveBeenCalledTimes(1);
    expect(reportRequestFailed).not.toHaveBeenCalled();
  });

  it('сообщает о сетевом сбое', async () => {
    const error = new TypeError('Network request failed');
    await expect(execute(() => Promise.reject(error))).rejects.toBe(error);
    expect(reportRequestFailed).toHaveBeenCalledTimes(1);
    expect(reportRequestSucceeded).not.toHaveBeenCalled();
  });

  it('пропускает прикладную ошибку без сигнала о связи', async () => {
    const error = new Error('Доступ запрещён');
    await expect(execute(() => Promise.reject(error))).rejects.toBe(error);
    expect(reportRequestSucceeded).not.toHaveBeenCalled();
    expect(reportRequestFailed).not.toHaveBeenCalled();
  });
});
