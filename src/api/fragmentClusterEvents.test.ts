import {
  EVENTS_FLUSH_DELAY_MS,
  flushClusterEvents,
  MAX_EVENTS_BATCH,
  trackClusterEvent,
} from './fragmentClusterEvents';

import { supabase } from '@/api/supabase';

jest.mock('@/api/supabase', () => ({ supabase: { rpc: jest.fn() } }));

const rpc = supabase.rpc as jest.Mock;

beforeEach(async () => {
  jest.useFakeTimers();
  await flushClusterEvents();
  rpc.mockReset();
  rpc.mockResolvedValue({ data: 1, error: null });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('trackClusterEvent', () => {
  it('копит события и отправляет их одной записью в фоне', async () => {
    trackClusterEvent({ kind: 'clusters_shown', messageId: 'm1', decisionId: 'd1', detail: { shown: 2 } });
    trackClusterEvent({ kind: 'cluster_opened', messageId: 'm1', decisionId: 'd1', clusterId: 'k1' });
    trackClusterEvent({ kind: 'area_opened', messageId: 'm1', rangeStart: 3, rangeEnd: 9 });

    expect(rpc).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(EVENTS_FLUSH_DELAY_MS);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('record_fragment_cluster_events', {
      events: [
        {
          kind: 'clusters_shown',
          message_id: 'm1',
          decision_id: 'd1',
          cluster_id: null,
          fragment_id: null,
          range_start: null,
          range_end: null,
          detail: { shown: 2 },
        },
        {
          kind: 'cluster_opened',
          message_id: 'm1',
          decision_id: 'd1',
          cluster_id: 'k1',
          fragment_id: null,
          range_start: null,
          range_end: null,
          detail: {},
        },
        {
          kind: 'area_opened',
          message_id: 'm1',
          decision_id: null,
          cluster_id: null,
          fragment_id: null,
          range_start: 3,
          range_end: 9,
          detail: {},
        },
      ],
    });
  });

  it('полная пачка уходит сразу и не больше лимита базы', async () => {
    for (let i = 0; i < MAX_EVENTS_BATCH; i += 1) trackClusterEvent({ kind: 'cluster_opened', messageId: `m${i}` });

    await Promise.resolve();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1].events).toHaveLength(MAX_EVENTS_BATCH);
  });

  it('сбой сети не доходит до вызывающего', async () => {
    rpc.mockRejectedValue(new Error('Network request failed'));

    expect(() => trackClusterEvent({ kind: 'quote_followed', messageId: 'm1', fragmentId: 'f1' })).not.toThrow();
    await expect(flushClusterEvents()).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('отказ базы тоже не бросает, а следующие события уходят своей пачкой', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'too many events' } });

    trackClusterEvent({ kind: 'cluster_opened', messageId: 'm1' });
    await expect(flushClusterEvents()).resolves.toBeUndefined();

    trackClusterEvent({ kind: 'cluster_opened', messageId: 'm2' });
    await jest.advanceTimersByTimeAsync(EVENTS_FLUSH_DELAY_MS);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1][1].events.map((e: { message_id: string }) => e.message_id)).toEqual(['m2']);
  });
});
