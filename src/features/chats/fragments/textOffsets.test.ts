import {
  boundaryAtOrAfter,
  boundaryAtOrBefore,
  fromServerRange,
  graphemeBoundaries,
  snapToBoundary,
  toCodePointOffset,
  toServerRange,
  toUtf16Offset,
  wordAt,
} from './textOffsets';

/** Графемы строкой — чтобы видеть, что склеилось. */
function graphemes(text: string): string[] {
  const bounds = graphemeBoundaries(text);

  return bounds.slice(1).map((end, i) => text.slice(bounds[i], end));
}

describe('grapheme boundaries', () => {
  it('splits plain Cyrillic and Latin letter by letter', () => {
    expect(graphemes('ок go')).toEqual(['о', 'к', ' ', 'g', 'o']);
    expect(graphemeBoundaries('')).toEqual([0]);
  });

  it('keeps a surrogate pair whole', () => {
    expect(graphemes('a😀b')).toEqual(['a', '😀', 'b']);
  });

  it('keeps an emoji with a skin tone modifier whole', () => {
    expect(graphemes('👍🏽!')).toEqual(['👍🏽', '!']);
  });

  it('keeps a ZWJ family whole', () => {
    expect(graphemes('x👨‍👩‍👧y')).toEqual(['x', '👨‍👩‍👧', 'y']);
  });

  it('keeps a variation selector with its emoji', () => {
    expect(graphemes('❤️❤️')).toEqual(['❤️', '❤️']);
  });

  it('pairs regional indicators into flags', () => {
    expect(graphemes('🇷🇺🇺🇦🇫')).toEqual(['🇷🇺', '🇺🇦', '🇫']);
  });

  it('keeps a tag-sequence flag whole', () => {
    const england = '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';

    expect(graphemes(`a${england}b`)).toEqual(['a', england, 'b']);
  });

  it('keeps combining marks with their letter', () => {
    expect(graphemes('е́ж')).toEqual(['е́', 'ж']);
    expect(graphemes('ñ́a')).toEqual(['ñ́', 'a']);
  });

  it('keeps CR LF and a Hangul syllable of jamo together', () => {
    expect(graphemes('a\r\nb')).toEqual(['a', '\r\n', 'b']);
    expect(graphemes('각가')).toEqual(['각', '가']);
  });
});

describe('snapping to graphemes', () => {
  const text = 'a👨‍👩‍👧b';
  const bounds = graphemeBoundaries(text);

  it('never stops inside an emoji', () => {
    for (let offset = 0; offset <= text.length; offset++) {
      expect(bounds).toContain(snapToBoundary(bounds, offset));
      expect(bounds).toContain(boundaryAtOrBefore(bounds, offset));
      expect(bounds).toContain(boundaryAtOrAfter(bounds, offset));
    }
  });

  it('rounds to the nearer boundary and clamps either way', () => {
    expect(snapToBoundary(bounds, 2)).toBe(1);
    expect(snapToBoundary(bounds, text.length - 2)).toBe(text.length - 1);
    expect(boundaryAtOrBefore(bounds, 3)).toBe(1);
    expect(boundaryAtOrAfter(bounds, 3)).toBe(text.length - 1);
  });
});

describe('word under the finger', () => {
  const at = (text: string, offset: number) => {
    const { start, end } = wordAt(text, offset);

    return text.slice(start, end);
  };

  it('takes the whole word around the offset', () => {
    expect(at('какой-то другой уровень', 2)).toBe('какой-то');
    expect(at('какой-то другой уровень', 12)).toBe('другой');
    expect(at('hello world', 10)).toBe('world');
  });

  it('keeps apostrophes and numbers inside a word', () => {
    expect(at("don't stop", 1)).toBe("don't");
    expect(at('pi = 3.14!', 5)).toBe('3.14');
  });

  it('takes a lone emoji or a punctuation mark as itself', () => {
    expect(at('ок 👍🏽 да', 4)).toBe('👍🏽');
    expect(at('стоп, да', 4)).toBe(',');
  });

  it('takes the word to the left from the space after it', () => {
    expect(at('слово конец', 5)).toBe('слово');
  });
});

describe('UTF-16 and code points', () => {
  const text = 'я👍🏽 и 👨‍👩‍👧!';

  it('counts emoji as several code points, not UTF-16 units', () => {
    // я · 👍 · 🏽 — три code points, но пять единиц UTF-16.
    expect(toCodePointOffset(text, 5)).toBe(3);
    expect(toUtf16Offset(text, 3)).toBe(5);
  });

  it('round-trips every code point boundary', () => {
    const points = [...text].length;

    for (let point = 0; point <= points; point++) {
      expect(toCodePointOffset(text, toUtf16Offset(text, point))).toBe(point);
    }
  });

  it('clamps past the end', () => {
    expect(toUtf16Offset(text, 999)).toBe(text.length);
    expect(toCodePointOffset(text, 999)).toBe([...text].length);
  });

  it('builds the server range with the exact piece of text, and back', () => {
    const start = text.indexOf('👨');
    const end = start + '👨‍👩‍👧'.length;
    const range = toServerRange(text, start, end);

    expect(range).toEqual({ start: 6, end: 11, text: '👨‍👩‍👧' });
    expect(fromServerRange(text, range.start, range.end)).toEqual({ start, end });
  });
});
