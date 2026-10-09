import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  BRUSH_SIZE_RANGE,
  DEFAULT_DRAW_COLOR,
  DEFAULT_DRAW_SETTINGS,
  parseDrawSettings,
  selectDrawBrush,
  setDrawBrushSize,
  useDrawSettings,
} from './drawSettings';

beforeEach(() => {
  useDrawSettings.setState(DEFAULT_DRAW_SETTINGS);
});

describe('кисти рисования', () => {
  it('по умолчанию — перо, красный у всех кистей с цветом', () => {
    expect(DEFAULT_DRAW_SETTINGS.brush).toBe('pen');
    expect(Object.values(DEFAULT_DRAW_SETTINGS.colors)).toEqual([
      DEFAULT_DRAW_COLOR,
      DEFAULT_DRAW_COLOR,
      DEFAULT_DRAW_COLOR,
    ]);
  });

  it('у каждой кисти своя толщина: смена одной другие не трогает', () => {
    setDrawBrushSize('pen', 3);
    setDrawBrushSize('marker', 40);

    const { sizes } = useDrawSettings.getState();

    expect(sizes.pen).toBe(3);
    expect(sizes.marker).toBe(40);
    expect(sizes.arrow).toBe(DEFAULT_DRAW_SETTINGS.sizes.arrow);
  });

  it('выбор кисти и толщина сохраняются на телефоне и читаются обратно', async () => {
    selectDrawBrush('marker');
    setDrawBrushSize('marker', 44);

    const saved = jest.mocked(AsyncStorage.setItem).mock.calls.at(-1)?.[1] ?? null;
    const restored = parseDrawSettings(saved);

    expect(restored.brush).toBe('marker');
    expect(restored.sizes.marker).toBe(44);
  });

  it('сохранённое с мусором не ломает рисование: неизвестное — по умолчанию, толщина в пределах', () => {
    expect(parseDrawSettings('не json')).toEqual(DEFAULT_DRAW_SETTINGS);
    expect(parseDrawSettings(null)).toEqual(DEFAULT_DRAW_SETTINGS);

    const parsed = parseDrawSettings(
      JSON.stringify({ brush: 'кисть', sizes: { pen: 1000 }, colors: { pen: 'red' } }),
    );

    expect(parsed.brush).toBe('pen');
    expect(parsed.sizes.pen).toBe(BRUSH_SIZE_RANGE.pen.max);
    expect(parsed.colors.pen).toBe(DEFAULT_DRAW_COLOR);
  });
});
