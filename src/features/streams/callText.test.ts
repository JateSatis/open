import type { CallMark } from '@/api/chats';
import {
  callBarLabel,
  callMarkText,
  formatCallDuration,
  formatCallTimer,
  onAirLabel,
} from '@/features/streams/callText';

const mark = (overrides: Partial<CallMark> = {}): CallMark => ({
  streamId: 's',
  event: 'call_ended',
  hostId: 'host',
  startedAt: '2026-10-01T10:00:00Z',
  endedAt: '2026-10-01T10:12:40Z',
  joinedByMe: false,
  ...overrides,
});

describe('длительность — та же запись, что у базы', () => {
  it.each([
    ['2026-10-01T10:00:42Z', '42 с'],
    ['2026-10-01T10:12:40Z', '12 мин'],
    ['2026-10-01T11:00:10Z', '1 ч'],
    ['2026-10-01T11:05:00Z', '1 ч 5 мин'],
  ])('до %s — «%s»', (endedAt, expected) => {
    expect(formatCallDuration('2026-10-01T10:00:00Z', endedAt)).toBe(expected);
  });
});

it('таймер звонка', () => {
  expect(formatCallTimer(7_000)).toBe('0:07');
  expect(formatCallTimer(760_000)).toBe('12:40');
  expect(formatCallTimer(3_725_000)).toBe('1:02:05');
});

it('полоса звонка: склонения и без слушателей', () => {
  expect(callBarLabel(3, 12)).toBe('Идёт звонок · 3 в звонке · 12 слушают');
  expect(callBarLabel(1, 1)).toBe('Идёт звонок · 1 в звонке · 1 слушает');
  expect(callBarLabel(2, 0)).toBe('Идёт звонок · 2 в звонке');
  expect(onAirLabel(21)).toBe('В эфире · слушает 21');
});

describe('системное сообщение', () => {
  const member = { id: 'me', isMember: true };

  it('начатый — кто начал; свой — «Вы начали»', () => {
    expect(callMarkText(mark({ event: 'call_started' }), member, 'Марина')).toBe(
      'Звонок начат · Марина',
    );
    expect(callMarkText(mark({ event: 'call_started', hostId: 'me' }), member, 'Я')).toBe(
      'Вы начали звонок',
    );
  });

  it('участник, не входивший в звонок, — пропущенный', () => {
    expect(callMarkText(mark(), member, 'Марина')).toBe('Пропущенный звонок');
  });

  it('входивший и начавший — завершённый с длительностью', () => {
    expect(callMarkText(mark({ joinedByMe: true }), member, 'Марина')).toBe(
      'Звонок завершён · 12 мин',
    );
    expect(callMarkText(mark({ hostId: 'me' }), member, 'Я')).toBe('Звонок завершён · 12 мин');
  });

  it('посетителю звонок не звонил — не пропущенный', () => {
    expect(callMarkText(mark(), { id: 'guest', isMember: false }, 'Марина')).toBe(
      'Звонок завершён · 12 мин',
    );
  });
});
