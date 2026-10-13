import { averageColor, mixColors } from './avatarTint';

jest.mock('@shopify/react-native-skia', () => ({}));

describe('averageColor', () => {
  it('averages the opaque pixels and ignores transparent ones', () => {
    const red = [200, 0, 0, 255];
    const clear = [0, 0, 255, 0];

    // Прозрачная точка не разбавляет цвет; тон чуть насыщеннее среднего.
    expect(averageColor([...red, ...red, ...clear])).toBe('#f70000');
    expect(averageColor([...red, ...clear])).toBe(averageColor(red));
  });

  it('has no colour for a fully transparent picture', () => {
    expect(averageColor([0, 0, 0, 0])).toBeNull();
  });
});

describe('mixColors', () => {
  it('blends two colours by share', () => {
    expect(mixColors('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixColors('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});
