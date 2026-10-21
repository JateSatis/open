import {
  boundaryAtOrAfter,
  boundaryAtOrBefore,
  extendByWords,
  fromServerRange,
  graphemeBoundaries,
  snapToBoundary,
  toCodePointOffset,
  toServerRange,
  toUtf16Offset,
  truncateGraphemes,
  wordAt,
  wordRangeAt,
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

describe('extending a selection by words', () => {
  /** Протяжка от слова `from` до смещения: что выделено. */
  function extend(text: string, from: string, to: number): string {
    const bounds = graphemeBoundaries(text);
    const at = text.indexOf(from);
    const range = extendByWords(text, bounds, { start: at, end: at + from.length }, to);

    return text.slice(range.start, range.end);
  }

  it('grows forward and backward by whole Cyrillic words', () => {
    const text = 'Мы идём в кино завтра';

    expect(extend(text, 'в', text.indexOf('ино'))).toBe('в кино');
    expect(extend(text, 'в', text.indexOf('дём'))).toBe('идём в');
    expect(extend(text, 'в', text.indexOf('в'))).toBe('в');
  });

  it('keeps the anchor word when the finger crosses back over it', () => {
    const text = 'один два три';

    expect(extend(text, 'два', text.length - 1)).toBe('два три');
    expect(extend(text, 'два', 0)).toBe('один два');
  });

  it("treats don’t, e-mail and 3.14 as single words", () => {
    const text = "say don’t send e-mail at 3.14 ok";

    expect(extend(text, 'say', text.indexOf('’'))).toBe('say don’t');
    expect(extend(text, 'send', text.indexOf('-'))).toBe('send e-mail');
    expect(extend(text, 'at', text.indexOf('.14'))).toBe('at 3.14');
  });

  it('takes an emoji whole, as one step', () => {
    const text = 'ура 🎉👍🏽 да';

    expect(extend(text, 'ура', text.indexOf('👍'))).toBe('ура 🎉👍🏽');
    expect(extend(text, 'да', text.indexOf('🎉') + 1)).toBe('🎉👍🏽 да');
  });

  it('does not end the selection on a space or a line break', () => {
    const text = 'первая строка\n\nвторая';

    expect(extend(text, 'первая', text.indexOf('\n') + 1)).toBe('первая строка');
    expect(extend(text, 'вторая', text.indexOf('\n') + 1)).toBe('вторая');
    expect(extend('a   b', 'b', 2)).toBe('b');
  });

  it('finds the same word as wordAt over precomputed bounds', () => {
    const text = 'кто-то пришёл';

    expect(wordRangeAt(text, graphemeBoundaries(text), 2)).toEqual(wordAt(text, 2));
    expect(wordRangeAt('', [0], 0)).toEqual({ start: 0, end: 0 });
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

describe('truncating to graphemes', () => {
  it('keeps a short text as is', () => {
    expect(truncateGraphemes('какой-то другой уровень', 100)).toBe('какой-то другой уровень');
  });

  it('cuts a long text at exactly the limit and adds an ellipsis', () => {
    const cut = truncateGraphemes('а'.repeat(150), 100);

    expect(cut).toBe(`${'а'.repeat(100)}…`);
  });

  it('a text of exactly the limit is not cut', () => {
    expect(truncateGraphemes('б'.repeat(100), 100)).toBe('б'.repeat(100));
  });

  it('does not split an emoji sitting on the limit', () => {
    const family = '👨‍👩‍👧';
    const cut = truncateGraphemes(`${'в'.repeat(99)}${family}${'г'.repeat(10)}`, 100);

    expect(cut).toBe(`${'в'.repeat(99)}${family}…`);
  });
});
