import { deleteBefore, insertAt } from './emojiText';

const at = (offset: number) => ({ start: offset, end: offset });

describe('insertAt', () => {
  it('puts the emoji at the cursor in the middle of the text and moves the cursor after it', () => {
    expect(insertAt('привет мир', at(6), '👋')).toEqual({
      text: 'привет👋 мир',
      selection: at(8),
    });
  });

  it('replaces the selection', () => {
    expect(insertAt('да нет', { start: 3, end: 6 }, '🙂')).toEqual({
      text: 'да 🙂',
      selection: at(5),
    });
  });

  it('survives a cursor past the end of a text that has just shrunk', () => {
    expect(insertAt('ок', at(10), '✅').text).toBe('ок✅');
  });
});

describe('deleteBefore', () => {
  it('erases one letter before the cursor', () => {
    expect(deleteBefore('абв', at(2))).toEqual({ text: 'ав', selection: at(1) });
  });

  it.each([
    ['a skin tone', '👍🏽'],
    ['a family', '👨‍👩‍👧‍👦'],
    ['a flag', '🇷🇺'],
    ['a tag flag', '🏴󠁧󠁢󠁳󠁣󠁴󠁿'],
    ['a keycap', '#️⃣'],
    ['a heart with a selector', '❤️'],
  ])('erases %s as a whole', (_name, emoji) => {
    const text = `x${emoji}y`;

    expect(deleteBefore(text, at(1 + emoji.length))).toEqual({ text: 'xy', selection: at(1) });
  });

  it('erases the selection', () => {
    expect(deleteBefore('один два', { start: 4, end: 8 })).toEqual({
      text: 'один',
      selection: at(4),
    });
  });

  it('has nothing to erase at the start', () => {
    expect(deleteBefore('абв', at(0))).toBeNull();
    expect(deleteBefore('', at(0))).toBeNull();
  });
});
