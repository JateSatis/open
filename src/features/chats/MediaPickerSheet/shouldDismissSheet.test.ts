import { FLING_VELOCITY, shouldDismissSheet } from './shouldDismissSheet';

const THRESHOLD = 150;

describe('shouldDismissSheet', () => {
  it('closes the sheet once it is dragged past the threshold', () => {
    expect(shouldDismissSheet(THRESHOLD + 1, THRESHOLD, 0)).toBe(true);
  });

  it('closes the sheet on a quick flick even from close to the working position', () => {
    expect(shouldDismissSheet(10, THRESHOLD, FLING_VELOCITY + 1)).toBe(true);
  });

  it('keeps the sheet when it was released short of the threshold', () => {
    // Ложное срабатывание здесь стоит дорого: человек чуть потянул шит, а у
    // него спросили, не выбросить ли выбранные файлы.
    expect(shouldDismissSheet(THRESHOLD - 1, THRESHOLD, 0)).toBe(false);
    expect(shouldDismissSheet(0, THRESHOLD, 0)).toBe(false);
  });

  it('keeps the sheet when it was dragged slowly and not far enough', () => {
    expect(shouldDismissSheet(THRESHOLD - 1, THRESHOLD, FLING_VELOCITY - 1)).toBe(false);
  });

  it('ignores a flick upwards, however fast', () => {
    expect(shouldDismissSheet(0, THRESHOLD, -FLING_VELOCITY * 10)).toBe(false);
  });
});
