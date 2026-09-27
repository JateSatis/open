import { CANCEL_DISTANCE, LOCK_DISTANCE } from './styles';
import { crossedThreshold } from './useRecordGesture';

describe('crossedThreshold', () => {
  it('does nothing while the finger stays near the button', () => {
    expect(crossedThreshold(-CANCEL_DISTANCE + 1, -LOCK_DISTANCE + 1)).toBeNull();
  });

  it('cancels once the finger is far enough to the left', () => {
    expect(crossedThreshold(-CANCEL_DISTANCE, 0)).toBe('cancel');
  });

  it('locks once the finger is far enough up', () => {
    expect(crossedThreshold(0, -LOCK_DISTANCE)).toBe('lock');
  });

  it('prefers cancelling when a diagonal passes both thresholds', () => {
    expect(crossedThreshold(-CANCEL_DISTANCE, -LOCK_DISTANCE)).toBe('cancel');
  });
});
