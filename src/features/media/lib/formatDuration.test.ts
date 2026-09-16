import { formatDuration } from './formatDuration';

describe('formatDuration', () => {
  it('formats under a minute with a leading zero minute', () => {
    expect(formatDuration(7_400)).toBe('0:07');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(95_000)).toBe('1:35');
  });

  it('adds hours only once there are hours', () => {
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });

  it('treats a negative or zero duration as zero', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(-500)).toBe('0:00');
  });
});
