import {
  arrowHead,
  brushPaintColor,
  drawingPlan,
  inkAlpha,
  inkOf,
  MARKER_OPACITY,
  normalizeInk,
  normalizeDrawing,
  smoothPath,
  type DrawBrush,
  type DrawStroke,
} from './drawing';
import { EMPTY_EDIT, hasDrawing, isEmptyEdit, normalizeEdit } from './types';

const stroke = (brush: DrawBrush, points: number[] = [0.1, 0.1, 0.2, 0.2]): DrawStroke => ({
  brush,
  color: '#ff3b30',
  width: 0.01,
  points,
});

describe('раскладка рисунка по слоям', () => {
  it('перо, стрелка и маркер — только в линии; размытие до рисунка — только по фото', () => {
    const blur = stroke('blur');
    const pen = stroke('pen');
    const arrow = stroke('arrow');
    const marker = stroke('marker');
    const plan = drawingPlan([blur, pen, arrow, marker]);

    expect(plan.blur).toEqual([{ kind: 'blur', stroke: blur }]);
    expect(plan.lines.map((op) => op.stroke)).toEqual([pen, arrow, marker]);
  });

  it('размытие поверх рисунка замазывает и его, нарисованное после — чёткое поверх', () => {
    const pen = stroke('pen');
    const blur = stroke('blur');
    const after = stroke('pen');
    const plan = drawingPlan([pen, blur, after]);

    expect(plan.blur).toEqual([{ kind: 'blur', stroke: blur }]);
    expect(plan.lines).toEqual([
      { kind: 'paint', stroke: pen },
      { kind: 'blur', stroke: blur },
      { kind: 'paint', stroke: after },
    ]);
  });

  it('ластик стирает в обоих слоях, на своём месте в истории', () => {
    const blur = stroke('blur');
    const pen = stroke('pen');
    const eraser = stroke('eraser');
    const after = stroke('pen');
    const plan = drawingPlan([blur, pen, eraser, after]);

    expect(plan.blur).toEqual([
      { kind: 'blur', stroke: blur },
      { kind: 'erase', stroke: eraser },
    ]);
    expect(plan.lines).toEqual([
      { kind: 'paint', stroke: pen },
      { kind: 'erase', stroke: eraser },
      { kind: 'paint', stroke: after },
    ]);
  });

  it('ластик до первого штриха слоя туда не кладётся — стирать там нечего', () => {
    const eraser = stroke('eraser');
    const blur = stroke('blur');
    const plan = drawingPlan([eraser, blur]);

    expect(plan.blur).toEqual([{ kind: 'blur', stroke: blur }]);
    expect(plan.lines).toEqual([]);
  });
});

describe('пустой рисунок', () => {
  it('ластик в начале ничего не стирает и отбрасывается', () => {
    const pen = stroke('pen');

    expect(normalizeDrawing([stroke('eraser'), pen])).toEqual([pen]);
    expect(normalizeDrawing([stroke('eraser')])).toEqual([]);
  });

  it('стёртые штрихи остаются: отмена должна вернуть ровно то, что было', () => {
    const drawing = [stroke('pen'), stroke('eraser')];

    expect(normalizeDrawing(drawing)).toBe(drawing);
  });

  it('правка только с рисунком — не пустая; пустой рисунок из правки уходит', () => {
    const drawn = { ...EMPTY_EDIT, drawing: [stroke('pen')] };

    expect(isEmptyEdit(drawn)).toBe(false);
    expect(hasDrawing(drawn)).toBe(true);
    expect(normalizeEdit({ ...EMPTY_EDIT, drawing: [] })).toEqual(EMPTY_EDIT);
    expect(isEmptyEdit(normalizeEdit({ ...EMPTY_EDIT, drawing: [stroke('eraser')] }))).toBe(true);
  });

  it('правка без пустых частей возвращается той же ссылкой', () => {
    const drawn = { ...EMPTY_EDIT, drawing: [stroke('pen')] };

    expect(normalizeEdit(drawn)).toBe(drawn);
    expect(normalizeEdit(EMPTY_EDIT)).toBe(EMPTY_EDIT);
  });
});

describe('сглаживание линии', () => {
  it('кривые через середины отрезков, от первой точки до последней', () => {
    expect(smoothPath([0, 0, 2, 0, 2, 2])).toEqual([
      { kind: 'move', x: 0, y: 0 },
      { kind: 'line', x: 1, y: 0 },
      { kind: 'quad', cx: 2, cy: 0, x: 2, y: 1 },
      { kind: 'line', x: 2, y: 2 },
    ]);
  });

  it('одна точка — точка, две — отрезок', () => {
    expect(smoothPath([1, 1])).toEqual([
      { kind: 'move', x: 1, y: 1 },
      { kind: 'line', x: 1, y: 1 },
    ]);
    expect(smoothPath([0, 0, 1, 1])).toHaveLength(2);
    expect(smoothPath([])).toEqual([]);
  });
});

describe('наконечник стрелки', () => {
  it('на конце линии, перья смотрят назад по направлению движения', () => {
    const head = arrowHead([0, 0, 0.5, 0, 1, 0], 0.01);

    expect(head).not.toBeNull();
    expect(head?.tipX).toBe(1);
    // Движение вправо — оба пера левее конца, по разные стороны линии.
    expect(head?.left[0]).toBeLessThan(1);
    expect(head?.right[0]).toBeLessThan(1);
    expect(Math.sign(head?.left[1] ?? 0)).toBe(-Math.sign(head?.right[1] ?? 0));
  });

  it('дрожь пальца в последних точках направление не сбивает', () => {
    // Длинная линия вправо и крошечный крючок вниз в самом конце.
    const head = arrowHead([0, 0, 0.5, 0, 1, 0, 1, 0.001], 0.01);
    const dx = (head?.tipX ?? 0) - ((head?.left[0] ?? 0) + (head?.right[0] ?? 0)) / 2;

    expect(dx).toBeGreaterThan(0);
  });

  it('у точки наконечника нет', () => {
    expect(arrowHead([0.5, 0.5], 0.01)).toBeNull();
    expect(arrowHead([0.5, 0.5, 0.5, 0.5], 0.01)).toBeNull();
  });
});

describe('цвет кисти с прозрачностью', () => {
  it('старый #rrggbb — непрозрачный, мусор — не цвет', () => {
    expect(normalizeInk('#FF3B30')).toBe('#ff3b30ff');
    expect(normalizeInk('#ff3b3080')).toBe('#ff3b3080');
    expect(normalizeInk('red')).toBeNull();
    expect(normalizeInk(42)).toBeNull();
  });

  it('цвет и прозрачность собираются в #rrggbbaa и разбираются обратно', () => {
    expect(inkOf('#0a84ff', 0.5)).toBe('#0a84ff80');
    expect(inkOf('#0a84ffff', 0)).toBe('#0a84ff00');
    expect(inkAlpha('#0a84ff80')).toBeCloseTo(0.5, 2);
  });

  it('у пера краска — цвет с его прозрачностью; у маркера прозрачность умножается', () => {
    expect(brushPaintColor('#ff000080', 'pen')).toBe(`rgba(255, 0, 0, ${128 / 255})`);
    expect(brushPaintColor('#ff000080', 'marker')).toBe(
      `rgba(255, 0, 0, ${(128 / 255) * MARKER_OPACITY})`,
    );
    expect(brushPaintColor('#ff0000ff', 'marker')).toBe(`rgba(255, 0, 0, ${MARKER_OPACITY})`);
  });
});
