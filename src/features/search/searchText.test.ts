import {
  findMatches,
  matchLevel,
  normalizeSearch,
  parseSearchQuery,
  snippetAround,
} from './searchText';

function highlighted(text: string, needle: string): string[] {
  return findMatches(text, needle).map(({ start, end }) => text.slice(start, end));
}

describe('normalizeSearch', () => {
  it('ignores case, ё/е, latin accents and extra spaces', () => {
    expect(normalizeSearch('  Ёлка   ПРИВЕТ  Café ')).toBe('елка привет cafe');
  });

  it('keeps й: the database does not fold it either', () => {
    expect(normalizeSearch('Йошкар')).toBe('йошкар');
  });
});

describe('parseSearchQuery', () => {
  it('reads @ as a username search', () => {
    expect(parseSearchQuery('@Max')).toEqual({
      text: 'max',
      username: 'max',
      byUsername: true,
      kind: null,
    });
  });

  it('narrows the kind by suffix, with or without @', () => {
    expect(parseSearchQuery('news.ch')).toMatchObject({ text: 'news', kind: 'channel' });
    expect(parseSearchQuery('@news.CH')).toMatchObject({ username: 'news', kind: 'channel' });
    expect(parseSearchQuery('team.di')).toMatchObject({ username: 'team', kind: 'group' });
  });

  it('does not treat a non-latin query as a username', () => {
    expect(parseSearchQuery('Ёлка')).toMatchObject({ text: 'елка', username: null });
  });
});

describe('matchLevel', () => {
  it('ranks exact above word start above the middle of a word', () => {
    expect(matchLevel('Квазар', 'квазар')).toBe(4);
    expect(matchLevel('Квазары тут', 'квазар')).toBe(3);
    expect(matchLevel('Новый квазар', 'квазар')).toBe(3);
    expect(matchLevel('Мегаквазар', 'квазар')).toBe(2);
    expect(matchLevel('Квазор', 'квазар')).toBe(0);
  });

  it('finds ёлка by елка', () => {
    expect(matchLevel('Ёлка', normalizeSearch('елка'))).toBe(4);
  });
});

describe('findMatches', () => {
  it('highlights the original letters, whatever their case and ё', () => {
    expect(highlighted('Привет всем', 'прив')).toEqual(['Прив']);
    expect(highlighted('Наша Ёлка', 'елка')).toEqual(['Ёлка']);
  });

  it('highlights the middle of a word', () => {
    expect(highlighted('канал телеграм', 'грам')).toEqual(['грам']);
  });

  it('highlights a different form of the word by its stem', () => {
    expect(highlighted('Одно сообщение', 'сообщения')).toEqual(['сообщени']);
  });

  it('highlights every word of a query when they are apart', () => {
    expect(highlighted('Планы на завтра и на выходные', 'планы выходные')).toEqual([
      'Планы',
      'выходные',
    ]);
  });

  it('maps through collapsed spaces back to the original string', () => {
    expect(highlighted('max    news', 'max news')).toEqual(['max    news']);
  });

  it('highlights nothing for a typo it cannot see', () => {
    expect(findMatches('телеграм', 'тлеграм')).toEqual([]);
  });
});

describe('snippetAround', () => {
  it('keeps a short message whole', () => {
    const ranges = findMatches('привет всем', 'всем');

    expect(snippetAround('привет всем', ranges)).toEqual({ text: 'привет всем', ranges });
  });

  it('starts a long message near the match, on a word boundary', () => {
    const text = `${'очень длинное начало сообщения без смысла '.repeat(5)}вот тут привет`;
    const snippet = snippetAround(text, findMatches(text, 'привет'));

    expect(snippet.text.startsWith('…')).toBe(true);
    expect(snippet.text.endsWith('вот тут привет')).toBe(true);
    expect(snippet.text.length).toBeLessThan(text.length);
    const [range] = snippet.ranges;
    expect(snippet.text.slice(range.start, range.end)).toBe('привет');
  });

  it('flattens line breaks', () => {
    expect(snippetAround('строка\nвторая', []).text).toBe('строка вторая');
  });
});
