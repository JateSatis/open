import {
  FUNCTION_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  UPLOAD_TIMEOUT_MS,
  timeoutFor,
  withRequestDeadline,
} from '@/api/requestDeadline';
import { DeadlineError } from '@/lib/deadline';
import { isNetworkError } from '@/lib/network';

const BASE = 'https://project.supabase.co';

/** `fetch`, который отвечает только на отмену — как сервер, принявший соединение и замолчавший. */
function silentFetch() {
  const calls: { signal: AbortSignal | undefined }[] = [];
  const fetchMock = jest.fn((_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const signal = init?.signal ?? undefined;

    calls.push({ signal });

    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
  });

  return { fetchMock: fetchMock as unknown as typeof fetch, calls };
}

describe('withRequestDeadline', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('обрывает молчащий запрос по сроку ошибкой связи', async () => {
    const { fetchMock } = silentFetch();
    const request = withRequestDeadline(fetchMock)(`${BASE}/rest/v1/messages`);
    const outcome = request.catch((error: unknown) => error);

    jest.advanceTimersByTime(REQUEST_TIMEOUT_MS - 1);
    await Promise.resolve();
    jest.advanceTimersByTime(1);

    const error = await outcome;

    expect(error).toBeInstanceOf(DeadlineError);
    expect(isNetworkError(error)).toBe(true);
  });

  it('ответ до срока проходит как есть', async () => {
    const response = { ok: true } as Response;
    const fetchMock = jest.fn(async () => response) as unknown as typeof fetch;

    await expect(withRequestDeadline(fetchMock)(`${BASE}/rest/v1/chats`)).resolves.toBe(response);
  });

  it('отмена вызывающим обрывает запрос его же ошибкой, а не сроком', async () => {
    const { fetchMock } = silentFetch();
    const outer = new AbortController();
    const request = withRequestDeadline(fetchMock)(`${BASE}/rest/v1/pops`, {
      signal: outer.signal,
    });

    outer.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('уже отменённый сигнал вызывающего не даёт запросу уйти', async () => {
    const { fetchMock, calls } = silentFetch();
    const outer = new AbortController();

    outer.abort();
    void withRequestDeadline(fetchMock)(`${BASE}/rest/v1/pops`, { signal: outer.signal }).catch(
      () => undefined,
    );

    expect(calls[0].signal?.aborted).toBe(true);
  });

  it('загрузку файла в Storage короткий срок не рвёт', async () => {
    const { fetchMock, calls } = silentFetch();

    void withRequestDeadline(fetchMock)(`${BASE}/storage/v1/object/media/u/video.mp4`, {
      method: 'POST',
      body: new ArrayBuffer(8),
    }).catch(() => undefined);

    jest.advanceTimersByTime(REQUEST_TIMEOUT_MS * 10);

    expect(calls[0].signal?.aborted).toBe(false);

    jest.advanceTimersByTime(UPLOAD_TIMEOUT_MS);

    expect(calls[0].signal?.aborted).toBe(true);
  });
});

describe('timeoutFor', () => {
  it('Edge Functions получают свой, более длинный срок', () => {
    expect(timeoutFor(`${BASE}/functions/v1/livekit-token`)).toBe(FUNCTION_TIMEOUT_MS);
  });

  it('служебные запросы Storage — обычный срок', () => {
    expect(
      timeoutFor(`${BASE}/storage/v1/object/media`, {
        method: 'DELETE',
        body: JSON.stringify({ prefixes: ['a'] }),
      }),
    ).toBe(REQUEST_TIMEOUT_MS);
  });

  it('обновление токена — обычный срок', () => {
    expect(timeoutFor(`${BASE}/auth/v1/token?grant_type=refresh_token`)).toBe(REQUEST_TIMEOUT_MS);
  });
});

describe('ошибка срока после обёрток Supabase', () => {
  it('PostgREST кладёт её в message как «DeadlineError: …» — это всё ещё сбой связи', () => {
    const error = new DeadlineError();

    expect(isNetworkError({ message: `${error.name}: ${error.message}`, code: '' })).toBe(true);
  });
});
