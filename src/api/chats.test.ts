import {
  ChatUsernameTakenError,
  listMessages,
  markChatRead,
  sendMessage,
  sendVoiceMessage,
  setChatUsername,
} from './chats';

import { isOpaquePersonId } from '@/api/opaquePeople';
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
    seq: Date.parse(createdAt),
    created_at: createdAt,
    attachments: [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
});

describe('people seen by the viewer', () => {
  it('takes author and system names from the row, never from profiles', async () => {
    const builder = new QueryBuilderMock({
      data: [
        {
          ...messageRow('m1', '2026-09-16T10:00:00Z'),
          author_id: 'opaque-x-1',
          author_name: 'Илья Муромцев',
          author_avatar_url: null,
          author_opaque: true,
        },
        {
          ...messageRow('m2', '2026-09-16T10:01:00Z'),
          kind: 'system',
          system_event: 'member_invited',
          author_id: 'user-1',
          author_name: 'Анна',
          author_opaque: false,
          system_user_id: 'opaque-x-2',
          system_user_name: 'Вера Соколова',
          system_user_opaque: true,
        },
      ],
      error: null,
    });
    mockedFrom.mockReturnValue(builder);

    const page = await listMessages('chat-1');

    expect(builder.argsOf('select')[0]).not.toContain('profiles');
    expect(page.items[0]).toMatchObject({
      authorId: 'opaque-x-1',
      authorOpaque: true,
      author: { displayName: 'Илья Муромцев', avatarUrl: null },
    });
    expect(page.items[1].member).toMatchObject({
      actorName: 'Анна',
      actorOpaque: false,
      subjectName: 'Вера Соколова',
      subjectOpaque: true,
    });
    // По непрозрачному id профиль не открывается; по настоящему — как раньше.
    expect(isOpaquePersonId('opaque-x-1')).toBe(true);
    expect(isOpaquePersonId('opaque-x-2')).toBe(true);
    expect(isOpaquePersonId('user-1')).toBe(false);
  });
});

describe('listMessages', () => {
  it('reads one page newest first and reports a cursor for the next one', async () => {
    const builder = new QueryBuilderMock({
      data: [messageRow('m2', '2026-09-16T10:01:00Z'), messageRow('m1', '2026-09-16T10:00:00Z')],
      error: null,
    });
    mockedFrom.mockReturnValue(builder);

    const page = await listMessages('chat-1', { limit: 2 });

    // Из представления: время в нём скрыто от тех, кому его не видно.
    expect(mockedFrom).toHaveBeenCalledWith('message_rows');
    expect(builder.argsOf('limit')).toEqual([2]);
    // Первый order — за порядок вложений внутри сообщения (см. messagesSelect).
    expect(builder.argsOf('order', 0)).toEqual(['position', { referencedTable: 'attachments' }]);
    // Порядок и курсор — номер, а не время: время бывает скрыто.
    expect(builder.argsOf('order', 1)).toEqual(['seq', { ascending: false }]);
    expect(page.items.map((message) => message.id)).toEqual(['m2', 'm1']);
    expect(page.nextCursor).toBe(Date.parse('2026-09-16T10:00:00Z'));
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

    await listMessages('chat-1', { cursor: 42 });

    expect(builder.argsOf('lt')).toEqual(['seq', 42]);
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

    // Id выбирает клиент: вставка не возвращает строку (время из таблицы не
    // читается), а читается она из представления по этому id.
    expect(builder.argsOf('insert')).toEqual([
      { id: expect.any(String), chat_id: 'chat-1', author_id: 'user-1', kind: 'text', text: 'привет' },
    ]);
    expect(builder.used('select')).toBe(true);
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

describe('sendVoiceMessage', () => {
  const mockedRpc = supabase.rpc as jest.MockedFunction<typeof supabase.rpc>;

  it('sends the recording and its waveform through the voice function', async () => {
    mockedRpc.mockResolvedValue({ data: 'v1', error: null } as never);
    mockedFrom.mockReturnValue(
      new QueryBuilderMock({
        data: {
          ...messageRow('v1', '2026-09-26T10:00:00Z'),
          kind: 'voice',
          text: null,
          attachments: [
            {
              id: 'a1',
              url: 'https://cdn.example/v.m4a',
              poster_url: null,
              mime_type: 'audio/mp4',
              width: null,
              height: null,
              duration_ms: 4200,
              waveform: [0, 31],
            },
          ],
        },
        error: null,
      }),
    );

    const message = await sendVoiceMessage('chat-1', {
      url: 'https://cdn.example/v.m4a',
      mimeType: 'audio/mp4',
      durationMs: 4200.6,
      sizeBytes: 3000,
      waveform: [0, 31],
    });

    expect(mockedRpc).toHaveBeenCalledWith('send_voice_message', {
      target_chat: 'chat-1',
      voice: {
        url: 'https://cdn.example/v.m4a',
        mime_type: 'audio/mp4',
        duration_ms: 4201,
        size_bytes: 3000,
        waveform: [0, 31],
      },
    });
    expect(message.kind).toBe('voice');
    expect(message.attachments[0].waveform).toEqual([0, 31]);
  });

  it('surfaces a refusal from the database as an error', async () => {
    mockedRpc.mockResolvedValue({
      data: null,
      error: { message: 'new row violates row-level security policy for table "messages"' },
    } as never);

    await expect(
      sendVoiceMessage('chat-1', {
        url: 'https://cdn.example/v.m4a',
        mimeType: 'audio/mp4',
        durationMs: 4200,
        sizeBytes: 3000,
        waveform: null,
      }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/row-level security/) });
  });
});

describe('setChatUsername', () => {
  const mockedRpc = supabase.rpc as jest.MockedFunction<typeof supabase.rpc>;

  it('writes the group username only through the database function', async () => {
    mockedRpc.mockResolvedValue({ data: 'team', error: null } as never);

    await setChatUsername('chat-1', 'team');

    expect(mockedRpc).toHaveBeenCalledWith('set_chat_username', {
      target_chat: 'chat-1',
      new_username: 'team',
    });
    expect(supabase.from).not.toHaveBeenCalledWith('chats');
  });

  it('clears the username with an empty value', async () => {
    mockedRpc.mockResolvedValue({ data: null, error: null } as never);

    await setChatUsername('chat-1', null);

    expect(mockedRpc).toHaveBeenCalledWith('set_chat_username', {
      target_chat: 'chat-1',
      new_username: '',
    });
  });

  it('turns OPN02 into a taken-username error', async () => {
    mockedRpc.mockResolvedValue({ data: null, error: { code: 'OPN02', message: 'taken' } } as never);

    await expect(setChatUsername('chat-1', 'team')).rejects.toBeInstanceOf(ChatUsernameTakenError);
  });

  it('passes the refusal for an outsider through', async () => {
    const refusal = { code: '42501', message: 'Менять имя группы может только участник' };

    mockedRpc.mockResolvedValue({ data: null, error: refusal } as never);

    await expect(setChatUsername('chat-1', 'team')).rejects.toBe(refusal);
  });
});
