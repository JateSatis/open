import { listMessageViews, MAX_VIEWS_BATCH, recordMessageViews } from './messageViews';

import { supabase } from '@/api/supabase';

jest.mock('@/api/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const rpc = supabase.rpc as jest.Mock;
const from = supabase.from as jest.Mock;

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe('recordMessageViews', () => {
  it('засчитывает пачку одним вызовом, с чатом и сессией', async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    await recordMessageViews('chat-1', ['m1', 'm2'], 'session-1');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('record_message_views', {
      target_chat: 'chat-1',
      message_ids: ['m1', 'm2'],
      session_id: 'session-1',
    });
  });

  it('пустую пачку не отправляет', async () => {
    await recordMessageViews('chat-1', [], 'session-1');

    expect(rpc).not.toHaveBeenCalled();
  });

  it('не отправляет больше, чем примет база', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const ids = Array.from({ length: MAX_VIEWS_BATCH + 5 }, (_, i) => `m${i}`);

    await recordMessageViews('chat-1', ids, 'session-1');

    expect(rpc.mock.calls[0][1].message_ids).toHaveLength(MAX_VIEWS_BATCH);
  });

  it('ошибку базы пробрасывает', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });

    await expect(recordMessageViews('chat-1', ['m1'], 's')).rejects.toEqual({ message: 'boom' });
  });
});

describe('listMessageViews', () => {
  it('читает счётчики и «прочитано» живых сообщений', async () => {
    const is = jest.fn().mockResolvedValue({
      data: [{ id: 'm1', views_count: 3, read_at: '2026-10-05T10:00:00Z' }],
      error: null,
    });
    const inFilter = jest.fn(() => ({ is }));
    const select = jest.fn(() => ({ in: inFilter }));

    from.mockReturnValue({ select });

    await expect(listMessageViews(['m1'])).resolves.toEqual([
      { id: 'm1', viewsCount: 3, readAt: '2026-10-05T10:00:00Z' },
    ]);
    expect(from).toHaveBeenCalledWith('messages');
    expect(is).toHaveBeenCalledWith('deleted_at', null);
  });
});
