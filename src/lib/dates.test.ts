import { formatDateTime, formatLastSeen } from './dates';

const now = new Date(2026, 9, 14, 18, 30);

describe('formatLastSeen', () => {
  it('says the time for today, «вчера» for yesterday and the date before that', () => {
    expect(formatLastSeen(new Date(2026, 9, 14, 16, 10).toISOString(), now)).toBe('был(а) в 16:10');
    expect(formatLastSeen(new Date(2026, 9, 13, 9, 40).toISOString(), now)).toBe(
      'был(а) вчера в 9:40',
    );
    expect(formatLastSeen(new Date(2026, 9, 3, 12, 0).toISOString(), now)).toBe('был(а) 3 окт');
  });

  it('adds the year for another year', () => {
    expect(formatLastSeen(new Date(2025, 4, 3, 12, 0).toISOString(), now)).toBe(
      'был(а) 3 мая 2025',
    );
  });

  it('says «давно» for someone who has never been seen', () => {
    expect(formatLastSeen(null, now)).toBe('был(а) давно');
  });
});

describe('formatDateTime', () => {
  it('reads like «23 июн в 14:16»', () => {
    expect(formatDateTime(new Date(2026, 5, 23, 14, 16).toISOString(), now)).toBe('23 июн в 14:16');
  });
});
