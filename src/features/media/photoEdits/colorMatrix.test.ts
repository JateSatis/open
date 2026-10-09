import { adjustColorMatrix, applyColorMatrix } from './colorMatrix';
import { NEUTRAL_ADJUST } from './types';

const ORANGE: [number, number, number] = [0.9, 0.5, 0.1];

function close(actual: number[], expected: number[]) {
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 5));
}

describe('adjustColorMatrix', () => {
  it('без правок не меняет цвет', () => {
    close(applyColorMatrix(adjustColorMatrix(NEUTRAL_ADJUST), ORANGE), ORANGE);
  });

  it('насыщенность −100 даёт серое той же яркости', () => {
    const [r, g, b] = applyColorMatrix(
      adjustColorMatrix({ ...NEUTRAL_ADJUST, saturation: -100 }),
      ORANGE,
    );
    const luma = 0.2126 * ORANGE[0] + 0.7152 * ORANGE[1] + 0.0722 * ORANGE[2];

    close([r, g, b], [luma, luma, luma]);
  });

  it('экспозиция +100 вдвое светлее, −100 вдвое темнее', () => {
    const grey: [number, number, number] = [0.2, 0.2, 0.2];

    close(applyColorMatrix(adjustColorMatrix({ ...NEUTRAL_ADJUST, exposure: 100 }), grey), [
      0.4, 0.4, 0.4,
    ]);
    close(applyColorMatrix(adjustColorMatrix({ ...NEUTRAL_ADJUST, exposure: -100 }), grey), [
      0.1, 0.1, 0.1,
    ]);
  });

  it('контраст не сдвигает середину и раздвигает края', () => {
    const matrix = adjustColorMatrix({ ...NEUTRAL_ADJUST, contrast: 100 });

    close(applyColorMatrix(matrix, [0.5, 0.5, 0.5]), [0.5, 0.5, 0.5]);
    expect(applyColorMatrix(matrix, [0.3, 0.3, 0.3])[0]).toBeLessThan(0.3);
    expect(applyColorMatrix(matrix, [0.7, 0.7, 0.7])[0]).toBeGreaterThan(0.7);
  });

  it('альфу не трогает', () => {
    const matrix = adjustColorMatrix({ exposure: 40, contrast: -30, saturation: 70 });

    expect(matrix.slice(15)).toEqual([0, 0, 0, 1, 0]);
  });
});
