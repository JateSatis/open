import { DeadlineError, withDeadline } from './deadline';

import { isNetworkError } from '@/lib/network';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('withDeadline', () => {
  it('passes the result through when it arrives in time', async () => {
    await expect(withDeadline(Promise.resolve(7), 1000)).resolves.toBe(7);
  });

  it('fails with an error the UI reads as a lost connection', async () => {
    const pending = withDeadline(new Promise<number>(() => undefined), 1000);

    jest.advanceTimersByTime(1000);

    await expect(pending).rejects.toBeInstanceOf(DeadlineError);
    await pending.catch((error: unknown) => expect(isNetworkError(error)).toBe(true));
  });

  it('hands a late result to onLate', async () => {
    let finish: (value: string) => void = () => undefined;
    const onLate = jest.fn();
    const pending = withDeadline(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
      1000,
      onLate,
    );

    jest.advanceTimersByTime(1000);
    await expect(pending).rejects.toBeInstanceOf(DeadlineError);

    finish('file');
    await Promise.resolve();

    expect(onLate).toHaveBeenCalledWith('file');
  });
});
