import {
  addRange,
  coveredByHidden,
  hiddenRangesLiteral,
  hiddenSegments,
  isMaskedText,
  overlapsHidden,
  parseHiddenRanges,
  removeRange,
  sameRanges,
  selectionToRange,
  shiftRanges,
  trimWithRanges,
} from './hiddenText';

describe('hiddenText', () => {
  it('разбирает ответ базы и отбрасывает мусор', () => {
    expect(parseHiddenRanges([[7, 15], [2, 4], 'x', [5, 5], [1]])).toEqual([
      { start: 2, end: 4 },
      { start: 7, end: 15 },
    ]);
    expect(parseHiddenRanges(null)).toEqual([]);
  });

  it('склеивает пересечения и соседей, литерал мультидиапазона', () => {
    const ranges = addRange([{ start: 0, end: 3 }], { start: 3, end: 6 });

    expect(ranges).toEqual([{ start: 0, end: 6 }]);
    expect(hiddenRangesLiteral([...ranges, { start: 9, end: 10 }])).toBe('{[0,6),[9,10)}');
  });

  it('снимает скрытие с куска — остаток по краям', () => {
    expect(removeRange([{ start: 0, end: 10 }], { start: 3, end: 5 })).toEqual([
      { start: 0, end: 3 },
      { start: 5, end: 10 },
    ]);
  });

  it('пересечение и покрытие', () => {
    const ranges = [{ start: 7, end: 15 }];

    expect(overlapsHidden(ranges, 14, 20)).toBe(true);
    expect(overlapsHidden(ranges, 15, 20)).toBe(false);
    expect(coveredByHidden(ranges, 8, 12)).toBe(true);
    expect(coveredByHidden(ranges, 6, 12)).toBe(false);
  });

  it('узнаёт замазанный текст зрителя', () => {
    expect(isMaskedText('учусь: ••••••••, класс', [{ start: 7, end: 15 }])).toBe(true);
    expect(isMaskedText('учусь: школа 57, класс', [{ start: 7, end: 15 }])).toBe(false);
    expect(isMaskedText('без скрытого', [])).toBe(false);
  });

  it('режет текст на куски в UTF-16, диапазоны — в code points', () => {
    expect(hiddenSegments('😀 кв 12, ок', [{ start: 2, end: 7 }])).toEqual([
      { text: '😀 ', hidden: false },
      { text: 'кв 12', hidden: true },
      { text: ', ок', hidden: false },
    ]);
  });

  describe('сдвиг при правке', () => {
    const ranges = [{ start: 6, end: 11 }]; // «школа» в «учусь школа 57»

    it('правка до скрытого сдвигает его', () => {
      expect(shiftRanges('учусь школа 57', 'Итак, учусь школа 57', ranges)).toEqual([
        { start: 12, end: 17 },
      ]);
    });

    it('правка после — не трогает', () => {
      expect(shiftRanges('учусь школа 57', 'учусь школа 571', ranges)).toEqual(ranges);
    });

    it('набранное сразу перед и сразу после скрытого остаётся открытым', () => {
      expect(shiftRanges('учусь школа 57', 'учусь Xшкола 57', ranges)).toEqual([
        { start: 7, end: 12 },
      ]);
      expect(shiftRanges('учусь школа 57', 'учусь школаX 57', ranges)).toEqual(ranges);
    });

    it('правка внутри растягивает, удаление скрытого целиком убирает', () => {
      expect(shiftRanges('учусь школа 57', 'учусь шкoola 57', ranges)).toEqual([
        { start: 6, end: 12 },
      ]);
      expect(shiftRanges('учусь школа 57', 'учусь  57', ranges)).toEqual([]);
    });
  });

  it('выделение поля ввода в обратную сторону', () => {
    expect(selectionToRange('😀 текст', 7, 3)).toEqual({ start: 2, end: 6 });
  });

  it('обрезка пробелов по краям сдвигает скрытое под текст, как его сохранит база', () => {
    expect(trimWithRanges('  мой адрес Ленина 5  ', [{ start: 12, end: 20 }])).toEqual({
      text: 'мой адрес Ленина 5',
      ranges: [{ start: 10, end: 18 }],
    });
    expect(trimWithRanges('  ', [{ start: 0, end: 2 }])).toEqual({ text: '', ranges: [] });
  });

  it('сравнение наборов скрытого', () => {
    expect(
      sameRanges(
        [
          { start: 0, end: 2 },
          { start: 2, end: 4 },
        ],
        [{ start: 0, end: 4 }],
      ),
    ).toBe(true);
    expect(sameRanges([{ start: 0, end: 2 }], [])).toBe(false);
  });
});
