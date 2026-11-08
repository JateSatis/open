import {
  getCommentTarget,
  listCommentThreadReplies,
  listCommentThreadRoots,
} from './comments';

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

describe('listCommentThreadReplies', () => {
  it('asks for one row past the page to know whether replies remain', async () => {
    const calls = serveReplies(0);

    await listCommentThreadReplies('root', { limit: 10 });

    expect(calls).toContainEqual({ method: 'limit', args: [11] });
  });

  it('a comment thread of exactly one page has nothing more to show', async () => {
    serveReplies(10);

    const page = await listCommentThreadReplies('root', { limit: 10 });

    expect(page.items).toHaveLength(10);
    expect(page.nextCursor).toBeNull();
  });

  it('a comment thread shorter than a page has nothing more to show', async () => {
    serveReplies(9);

    const page = await listCommentThreadReplies('root', { limit: 10 });

    expect(page.items).toHaveLength(9);
    expect(page.nextCursor).toBeNull();
  });

  it('an extra row means more replies: the page stops at its last shown reply', async () => {
    serveReplies(11);

    const page = await listCommentThreadReplies('root', { limit: 10 });

    expect(page.items.map((c) => c.id)).toEqual(rows(10).map((r) => r.id));
    expect(page.nextCursor).toEqual({ createdAt: row(10).created_at, id: 'c10' });
  });
});

describe('listCommentThreadRoots', () => {
  it('a full last page has no next cursor', async () => {
    const calls = serveRoots(30);

    const page = await listCommentThreadRoots('m1', { limit: 30 });

    expect(calls[0].args[0]).toMatchObject({ page_size: 31 });
    expect(page.items).toHaveLength(30);
    expect(page.nextCursor).toBeNull();
  });

  it('an extra row continues after the last shown root', async () => {
    serveRoots(31);

    const page = await listCommentThreadRoots('m1', { limit: 30 });

    expect(page.items).toHaveLength(30);
    expect(page.nextCursor).toEqual({ rank: row(30).rank, id: 'c30' });
  });
});

describe('fragment quote', () => {
  function serveRows(data: unknown[]) {
    mockedRpc.mockImplementation(() => chain({ data, error: null }, []));
  }

  it('a comment to a fragment carries its quote, current range and whether it is lost', async () => {
    serveRows([
      {
        ...row(1),
        thread_root_id: null,
        fragment_id: 'f1',
        fragment: {
          start_offset: 4,
          end_offset: 27,
          exact_text: 'какой-то другой уровень',
          anchor_state: 'shifted',
        },
      },
      {
        ...row(2),
        thread_root_id: null,
        fragment_id: 'f2',
        fragment: { start_offset: 0, end_offset: 5, exact_text: 'было', anchor_state: 'lost' },
      },
    ]);

    const { items } = await listCommentThreadRoots('m1', {
      set: { kind: 'cluster', clusterId: 'k1' },
    });

    expect(items[0]).toMatchObject({
      fragmentId: 'f1',
      fragmentQuote: { text: 'какой-то другой уровень', start: 4, end: 27, lost: false },
    });
    expect(items[1].fragmentQuote).toMatchObject({ text: 'было', lost: true });
  });

  it('a plain comment has no quote', async () => {
    serveRows([{ ...row(1), fragment_id: null, fragment: null }]);

    const { items } = await listCommentThreadRoots('m1');

    expect(items[0].fragmentId).toBeNull();
    expect(items[0].fragmentQuote).toBeNull();
  });

  it('a fragment hidden with its deleted message leaves the id without a quote', async () => {
    serveRows([{ ...row(1), fragment_id: 'f1', fragment: null }]);

    const { items } = await listCommentThreadRoots('m1');

    expect(items[0]).toMatchObject({ fragmentId: 'f1', fragmentQuote: null });
  });
});

/** Имена связей верхнего уровня в `select` PostgREST — без вложенных. */
function topLevelEmbeds(select: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let item = '';

  for (const char of `${select},`) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      const embed = /^\s*(\w+):/.exec(item);
      if (embed) names.push(embed[1]);
      item = '';
    } else {
      item += char;
    }
  }

  return names;
}

describe('getCommentTarget', () => {
  it('names every embed once: a repeated alias makes PostgREST reject the whole query', async () => {
    const calls: { method: string; args: unknown[] }[] = [];
    mockedFrom.mockReturnValue(chain({ data: null, error: null }, calls));
    mockedRpc.mockReturnValue(chain({ data: [], error: null }, []));

    await expect(getCommentTarget('m1')).resolves.toEqual({ state: 'missing' });

    const select = calls.find((call) => call.method === 'select')?.args[0] as string;
    const embeds = topLevelEmbeds(select);

    // Автор — колонками глазами смотрящего, а не связью с профилями.
    expect(select).toContain('author_name');
    expect(embeds).not.toContain('author');
    expect(new Set(embeds).size).toBe(embeds.length);
  });
});
