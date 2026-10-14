import { formatCount, readersLabel, subscribersLabel } from './subscriberText';

describe('subscriber labels', () => {
  it.each([
    [0, '0 читателей'],
    [1, '1 читатель'],
    [2, '2 читателя'],
    [5, '5 читателей'],
    [11, '11 читателей'],
    [21, '21 читатель'],
    [104, '104 читателя'],
  ])('%i → %s', (n, label) => expect(readersLabel(n)).toBe(label));

  it('declines subscribers the same way', () => {
    expect(subscribersLabel(1)).toBe('1 подписчик');
    expect(subscribersLabel(3)).toBe('3 подписчика');
    expect(subscribersLabel(12)).toBe('12 подписчиков');
  });
});

describe('formatCount', () => {
  it('groups thousands with a non-breaking space', () => {
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1234)).toBe('1 234');
    expect(subscribersLabel(12345)).toBe('12 345 подписчиков');
  });
});
