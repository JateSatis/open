import { getLastSeen } from './chatInfo';

import { supabase } from '@/api/supabase';

jest.mock('@/api/supabase', () => ({ supabase: { from: jest.fn() } }));

describe('getLastSeen', () => {
  it('asks in batches so a big group does not overflow the request address', async () => {
    const asked: string[][] = [];
    jest.mocked(supabase.from).mockImplementation(
      () =>
        ({
          select: () => ({
            in: (_column: string, ids: string[]) => {
              asked.push(ids);
              return Promise.resolve({
                data: ids.map((id) => ({
                  id,
                  last_seen_at: id === 'u0' ? '2026-10-14T10:00:00Z' : null,
                })),
                error: null,
              });
            },
          }),
        }) as never,
    );

    const ids = Array.from({ length: 250 }, (_, at) => `u${at}`);
    const seen = await getLastSeen(ids);

    expect(asked.map((batch) => batch.length)).toEqual([100, 100, 50]);
    expect(seen.size).toBe(250);
    expect(seen.get('u0')).toBe('2026-10-14T10:00:00Z');
    expect(seen.get('u1')).toBeNull();
  });
});
