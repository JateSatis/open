import { watchRealtimeConnection } from './connection';
import { createAccountClient, selectApiClient, supabase } from './supabase';

it('перепривязывает heartbeat к выбранному клиенту после локального восстановления и выбора', () => {
  const a = createAccountClient();
  const b = createAccountClient();
  const initial = jest.spyOn(supabase.realtime, 'onHeartbeat');
  const first = jest.spyOn(a.realtime, 'onHeartbeat');
  const second = jest.spyOn(b.realtime, 'onHeartbeat');
  const report = jest.fn();
  const stop = watchRealtimeConnection(report);
  try {
    selectApiClient(a);
    selectApiClient(b);
    report.mockClear();
    initial.mock.calls[0][0]('ok');
    first.mock.calls[0][0]('timeout');
    expect(report).not.toHaveBeenCalled();
    second.mock.calls[0][0]('ok');
    expect(report).toHaveBeenCalledWith('joined');
    stop();
    report.mockClear();
    second.mock.calls[0][0]('timeout');
    expect(report).not.toHaveBeenCalled();
  } finally {
    stop();
    selectApiClient(null);
    jest.restoreAllMocks();
  }
});
