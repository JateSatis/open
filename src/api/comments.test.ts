import { listThreadReplies, listThreadRoots } from './comments';

import { supabase } from '@/api/supabase';

jest.mock('@/api/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

type QueryResult = { data: unknown; error: null };

/** Цепочка PostgREST: любой метод возвращает её же, `await` отдаёт результат. */
function chain(result: QueryResult, calls: { method: string; args: unknown[] }[]): unknown {
  const target = {
    then: (resolve: (value: QueryResult) => unknown) => Promise.resolve(result).then(resolve),
  };
  const proxy: unknown = new Proxy(target, {
    get(obj, prop) {
      if (prop === 'then') return obj.then;
      return (...args: unknown[]) => {
        calls.push({ method: String(prop), args });
        return proxy;
      };
    },
  });
  return proxy;
}

function row(n: number) {
  return {
    id: `c${n}`,
    message_id: 'm1',
    chat_id: 'chat-1',
    author_id: 'u1',
    author: { display_name: 'Аня', avatar_url: null },
    audience: 'visitor',
    kind: 'text',
    text: `ответ ${n}`,
    created_at: new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString(),
    edited_at: null,
    deleted_at: null,
    comment_attachments: [],
    replies: [],
    thread_root_id: 'root',
    replies_count: 0,
    rank: 100 - n,
    member_reactions: {},
    visitor_reactions: {},
    reactions_count: 0,
    my_reaction: [],
  };
}

const rows = (count: number) => Array.from({ length: count }, (_, i) => row(i + 1));

const mockedFrom = supabase.from as jest.Mock;
const mockedRpc = supabase.rpc as jest.Mock;

function serveReplies(count: number) {
  const calls: { method: string; args: unknown[] }[] = [];
  mockedFrom.mockReturnValue(chain({ data: rows(count), error: null }, calls));
  return calls;
}

function serveRoots(count: number) {
  const calls: { method: string; args: unknown[] }[] = [];
  mockedRpc.mockImplementation((_name: string, args: unknown) => {
    calls.push({ method: 'rpc', args: [args] });
    return chain({ data: rows(count), error: null }, calls);
  });
  return calls;
}

describe('listThreadReplies', () => {
  it('asks for one row past the page to know whether replies remain', async () => {
    const calls = serveReplies(0);

    await listThreadReplies('root', { limit: 10 });

    expect(calls).toContainEqual({ method: 'limit', args: [11] });
  });

  it('a thread of exactly one page has nothing more to show', async () => {
    serveReplies(10);

    const page = await listThreadReplies('root', { limit: 10 });

    expect(page.items).toHaveLength(10);
    expect(page.nextCursor).toBeNull();
  });

  it('a thread shorter than a page has nothing more to show', async () => {
    serveReplies(9);

    const page = await listThreadReplies('root', { limit: 10 });

    expect(page.items).toHaveLength(9);
    expect(page.nextCursor).toBeNull();
  });

  it('an extra row means more replies: the page stops at its last shown reply', async () => {
    serveReplies(11);

    const page = await listThreadReplies('root', { limit: 10 });

    expect(page.items.map((c) => c.id)).toEqual(rows(10).map((r) => r.id));
    expect(page.nextCursor).toBe(row(10).created_at);
  });
});

describe('listThreadRoots', () => {
  it('a full last page has no next cursor', async () => {
    const calls = serveRoots(30);

    const page = await listThreadRoots('m1', { limit: 30 });

    expect(calls[0].args[0]).toMatchObject({ page_size: 31 });
    expect(page.items).toHaveLength(30);
    expect(page.nextCursor).toBeNull();
  });

  it('an extra row continues after the last shown root', async () => {
    serveRoots(31);

    const page = await listThreadRoots('m1', { limit: 30 });

    expect(page.items).toHaveLength(30);
    expect(page.nextCursor).toEqual({ rank: row(30).rank, id: 'c30' });
  });
});
