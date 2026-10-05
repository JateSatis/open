import { formatViewsCount } from './formatViewsCount';

describe('formatViewsCount', () => {
  it.each([
    [1, '1'],
    [999, '999'],
    [1000, '1K'],
    [1250, '1,2K'],
    [9999, '9,9K'],
    [15_400, '15K'],
    [999_999, '999K'],
    [1_000_000, '1M'],
    [2_480_000, '2,4M'],
    [31_000_000, '31M'],
  ])('%i → %s', (count, label) => {
    expect(formatViewsCount(count)).toBe(label);
  });
});
