import { listMessages, markChatRead, sendMessage } from './chats';

import { supabase } from '@/api/supabase';

jest.mock('@/api/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    auth: { getUser: jest.fn() },
  },
}));

type QueryResult = { data: unknown; error: { message: string } | null };

/** Records the PostgREST calls a query makes and resolves to a fixed result. */
class QueryBuilderMock implements PromiseLike<QueryResult> {
  readonly calls: { method: string; args: unknown[] }[] = [];

  constructor(private readonly result: QueryResult) {}

  private record(method: string, args: unknown[]): this {
    this.calls.push({ method, args });
    return this;
  }

  select(...args: unknown[]) {
    return this.record('select', args);
  }
  insert(...args: unknown[]) {
    return this.record('insert', args);
  }
  eq(...args: unknown[]) {
    return this.record('eq', args);
  }
  is(...args: unknown[]) {
    return this.record('is', args);
  }
  lt(...args: unknown[]) {
    return this.record('lt', args);
  }
  gt(...args: unknown[]) {
    return this.record('gt', args);
  }
  order(...args: unknown[]) {
    return this.record('order', args);
  }
  limit(...args: unknown[]) {
    return this.record('limit', args);
  }
  single(...args: unknown[]) {
    return this.record('single', args);
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }

  used(method: string): boolean {
    return this.calls.some((call) => call.method === method);
  }

  /** `occurrence` picks which call to a method that is used more than once, 0-based. */
  argsOf(method: string, occurrence = 0): unknown[] {
    return this.calls.filter((call) => call.method === method)[occurrence]?.args ?? [];
  }
}

const mockedFrom = supabase.from as unknown as jest.Mock;
const mockedGetUser = supabase.auth.getUser as unknown as jest.Mock;

function messageRow(id: string, createdAt: string) {
  return {
    id,
    chat_id: 'chat-1',
    author_id: 'user-1',
    kind: 'text',
    text: `сообщение ${id}`,
    created_at: createdAt,
    attachments: [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
});

describe('listMessages', () => {
  it('reads one page newest first and reports a cursor for the next one', async () => {
    const builder = new QueryBuilderMock({
      data: [messageRow('m2', '2026-09-16T10:01:00Z'), messageRow('m1', '2026-09-16T10:00:00Z')],
      error: null,
    });
    mockedFrom.mockReturnValue(builder);

    const page = await listMessages('chat-1', { limit: 2 });

    expect(mockedFrom).toHaveBeenCalledWith('messages');
    expect(builder.argsOf('limit')).toEqual([2]);
    // Первый order — за порядок вложений внутри сообщения (см. messagesSelect).
    expect(builder.argsOf('order', 0)).toEqual(['position', { referencedTable: 'attachments' }]);
    expect(builder.argsOf('order', 1)).toEqual(['created_at', { ascending: false }]);
    expect(page.items.map((message) => message.id)).toEqual(['m2', 'm1']);
    expect(page.nextCursor).toBe('2026-09-16T10:00:00Z');
  });

  it('stops paging when the page is not full', async () => {
    const builder = new QueryBuilderMock({
      data: [messageRow('m1', '2026-09-16T10:00:00Z')],
      error: null,
    });
    mockedFrom.mockReturnValue(builder);

    const page = await listMessages('chat-1', { limit: 2 });

    expect(page.nextCursor).toBeNull();
  });

  it('walks further back from the cursor instead of loading the whole chat', async () => {
    const builder = new QueryBuilderMock({ data: [], error: null });
    mockedFrom.mockReturnValue(builder);

    await listMessages('chat-1', { cursor: '2026-09-16T10:00:00Z' });

    expect(builder.argsOf('lt')).toEqual(['created_at', '2026-09-16T10:00:00Z']);
  });

  it('does not filter by cursor on the first page', async () => {
    const builder = new QueryBuilderMock({ data: [], error: null });
    mockedFrom.mockReturnValue(builder);

    await listMessages('chat-1');

    expect(builder.used('lt')).toBe(false);
  });
});

describe('sendMessage', () => {
  it('inserts the message as the signed-in author', async () => {
    const builder = new QueryBuilderMock({
      data: messageRow('m1', '2026-09-16T10:00:00Z'),
      error: null,
    });
    mockedFrom.mockReturnValue(builder);

    const message = await sendMessage('chat-1', { text: '  привет  ' });

    expect(builder.argsOf('insert')).toEqual([
      { chat_id: 'chat-1', author_id: 'user-1', kind: 'text', text: 'привет' },
    ]);
    expect(message.id).toBe('m1');
  });

  it('surfaces the RLS rejection when the sender is not a chat member', async () => {
    const builder = new QueryBuilderMock({
      data: null,
      error: { message: 'new row violates row-level security policy for table "messages"' },
    });
    mockedFrom.mockReturnValue(builder);

    await expect(sendMessage('chat-1', { text: 'привет' })).rejects.toEqual({
      message: 'new row violates row-level security policy for table "messages"',
    });
  });

  it('refuses an empty message', async () => {
    await expect(sendMessage('chat-1', { text: '   ' })).rejects.toThrow(/Пустое сообщение/);
  });

  describe('with media', () => {
    const mockedRpc = supabase.rpc as jest.MockedFunction<typeof supabase.rpc>;

    it('sends the message and its attachments through one transactional call', async () => {
      mockedRpc.mockResolvedValue({ data: 'm2', error: null } as never);
      const builder = new QueryBuilderMock({
        data: { ...messageRow('m2', '2026-09-16T10:02:00Z'), kind: 'media' },
        error: null,
      });
      mockedFrom.mockReturnValue(builder);

      const message = await sendMessage('chat-1', {
        text: 'смотри',
        media: [
          {
            url: 'https://cdn.example/a.mp4',
            posterUrl: 'https://cdn.example/a.jpg',
            mimeType: 'video/mp4',
            width: 800,
            height: 600,
            durationMs: 5000,
            sizeBytes: 1234,
          },
        ],
      });

      expect(mockedRpc).toHaveBeenCalledWith('send_media_message', {
        target_chat: 'chat-1',
        message_text: 'смотри',
        media: [
          {
            url: 'https://cdn.example/a.mp4',
            poster_url: 'https://cdn.example/a.jpg',
            mime_type: 'video/mp4',
            width: 800,
            height: 600,
            duration_ms: 5000,
            size_bytes: 1234,
          },
        ],
      });
      // После RPC сообщение перечитывается полной строкой — с ней уже
      // работает остальной код (вложения, kind и т.д.).
      expect(builder.argsOf('eq')).toEqual(['id', 'm2']);
      expect(message.id).toBe('m2');
    });

    it('allows media without any text', async () => {
      mockedRpc.mockResolvedValue({ data: 'm3', error: null } as never);
      mockedFrom.mockReturnValue(
        new QueryBuilderMock({ data: messageRow('m3', '2026-09-16T10:03:00Z'), error: null }),
      );

      await sendMessage('chat-1', {
        media: [
          {
            url: 'https://cdn.example/b.jpg',
            posterUrl: null,
            mimeType: 'image/jpeg',
            width: null,
            height: null,
            durationMs: null,
            sizeBytes: 10,
          },
        ],
      });

      expect(mockedRpc).toHaveBeenCalledWith(
        'send_media_message',
        expect.objectContaining({ message_text: null }),
      );
    });

    it('surfaces a rejection from the database function', async () => {
      mockedRpc.mockResolvedValue({ data: null, error: { message: 'нельзя больше 50' } } as never);

      await expect(
        sendMessage('chat-1', {
          media: [
            {
              url: 'https://cdn.example/c.jpg',
              posterUrl: null,
              mimeType: 'image/jpeg',
              width: null,
              height: null,
              durationMs: null,
              sizeBytes: 10,
            },
          ],
        }),
      ).rejects.toEqual({ message: 'нельзя больше 50' });
    });
  });
});

describe('markChatRead', () => {
  const mockedRpc = supabase.rpc as jest.MockedFunction<typeof supabase.rpc>;

  it('lets the database stamp the time instead of sending the device clock', async () => {
    mockedRpc.mockResolvedValue({ data: null, error: null } as never);

    await markChatRead('chat-1');

    expect(mockedRpc).toHaveBeenCalledWith('mark_chat_read', { target_chat: 'chat-1' });
    // Часы устройства сюда попасть не должны: сообщения штампует сервер, и
    // отставшие на секунды часы оставили бы их непрочитанными навсегда.
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it('surfaces a rejection instead of pretending the chat was read', async () => {
    mockedRpc.mockResolvedValue({ data: null, error: { message: 'нет доступа' } } as never);

    await expect(markChatRead('chat-1')).rejects.toEqual({ message: 'нет доступа' });
  });
});
