import { getLastSeen } from './chatInfo';

import { supabase } from '@/api/supabase';

jest.mock('@/api/supabase', () => ({ supabase: { rpc: jest.fn() } }));

describe('getLastSeen', () => {
  it('asks the server in batches it accepts, and takes its answer as is', async () => {
    const asked: string[][] = [];
    jest.mocked(supabase.rpc).mockImplementation(((_name: string, args: { user_ids: string[] }) => {
      asked.push(args.user_ids);
      return Promise.resolve({
        data: args.user_ids.map((id) => ({
          user_id: id,
          online: id === 'u1',
          last_seen_at: id === 'u0' ? '2026-10-14T10:00:00Z' : null,
        })),
        error: null,
      });
    }) as never);

    const ids = Array.from({ length: 450 }, (_, at) => `u${at}`);
    const seen = await getLastSeen(ids);

    expect(supabase.rpc).toHaveBeenCalledWith('activity_statuses', expect.anything());
    expect(asked.map((batch) => batch.length)).toEqual([200, 200, 50]);
    expect(seen.size).toBe(450);
    expect(seen.get('u0')).toEqual({ online: false, lastSeenAt: '2026-10-14T10:00:00Z' });
    expect(seen.get('u1')).toEqual({ online: true, lastSeenAt: null });
  });

  it('shows what the server hid exactly like «never seen»: the setting is applied there', async () => {
    // Скрытое настройкой база отдаёт как у ни разу не заходившего —
    // клиент не отличает одно от другого и ничего не достраивает.
    jest.mocked(supabase.rpc).mockResolvedValue({
      data: [{ user_id: 'teen', online: false, last_seen_at: null }],
      error: null,
    } as never);

    const seen = await getLastSeen(['teen']);

    expect(seen.get('teen')).toEqual({ online: false, lastSeenAt: null });
  });
});
