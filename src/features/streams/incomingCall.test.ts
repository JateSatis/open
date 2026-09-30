import type { IncomingCall } from '@/api/chats';
import { useInAppAlert } from '@/features/notifications/alertsStore';
import { setCall } from '@/features/streams/callStore';
import {
  RING_MS,
  declineRinging,
  resetRinging,
  ring,
  stopRinging,
  useIncomingCall,
} from '@/features/streams/incomingCall';
import { setInCall } from '@/store/callPresence';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const NOW = Date.parse('2026-10-01T12:00:00Z');

function incoming(overrides: Partial<IncomingCall> = {}): IncomingCall {
  return {
    streamId: 'stream-1',
    chatId: 'chat-1',
    chatTitle: 'Поход',
    chatKind: 'group',
    hostId: 'user-2',
    hostName: 'Марина',
    startedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

const ringing = () => useIncomingCall.getState().ringing;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  resetRinging();
  setInCall(false);
  setCall(null);
  useInAppAlert.setState({ alert: null });
});

afterEach(() => jest.useRealTimers());

it('звонит ограниченное время и затихает сам', () => {
  ring(incoming());
  expect(ringing()?.streamId).toBe('stream-1');

  jest.advanceTimersByTime(RING_MS - 1000);
  expect(ringing()).not.toBeNull();

  jest.advanceTimersByTime(1000);
  expect(ringing()).toBeNull();
});

it('звонит только остаток окна, если событие пришло с опозданием', () => {
  ring(incoming({ startedAt: new Date(NOW - RING_MS + 5000).toISOString() }));

  jest.advanceTimersByTime(5000);
  expect(ringing()).toBeNull();
});

it('звонок, которому больше 45 секунд, не звонит вовсе', () => {
  ring(incoming({ startedAt: new Date(NOW - RING_MS - 1).toISOString() }));

  expect(ringing()).toBeNull();
});

it('отклонённый звонок не звонит повторно, другой — звонит', () => {
  ring(incoming());
  declineRinging();
  ring(incoming());

  expect(ringing()).toBeNull();

  ring(incoming({ streamId: 'stream-2' }));
  expect(ringing()?.streamId).toBe('stream-2');
});

it('уже в звонке — без полноэкранного входящего, только короткая карточка', () => {
  setInCall(true);

  ring(incoming());

  expect(ringing()).toBeNull();
  const alert = useInAppAlert.getState().alert;
  expect(alert?.kind === 'notice' && alert.text).toBe('Входящий звонок · Поход');
});

it('звонок кончился, пока звонил, — затихает', () => {
  ring(incoming());
  stopRinging('stream-1');

  expect(ringing()).toBeNull();
});

it('чужой конец не гасит мой входящий', () => {
  ring(incoming());
  stopRinging('stream-9');

  expect(ringing()?.streamId).toBe('stream-1');
});
