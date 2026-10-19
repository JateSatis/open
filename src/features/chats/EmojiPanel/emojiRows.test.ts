import { buildEmojiGrid, EMOJI_SECTIONS } from './emojiRows';

describe('buildEmojiGrid', () => {
  it('starts with «Недавние», last picked first, then every section under its title', () => {
    const { rows, starts } = buildEmojiGrid(['🔥', '😀'], 8);

    expect(EMOJI_SECTIONS[0].title).toBe('Недавние');
    expect(rows[0]).toMatchObject({ type: 'header', title: 'Недавние' });
    expect(rows[1]).toMatchObject({ type: 'row', emojis: ['🔥', '😀'] });
    expect(rows[starts.smileys]).toMatchObject({ type: 'header', title: 'Смайлы и эмоции' });
    expect(rows[starts.flags]).toMatchObject({ type: 'header', title: 'Флаги' });
  });

  it('lays emoji out in rows of the given width', () => {
    const { rows } = buildEmojiGrid([], 7);
    const emojiRows = rows.filter((row) => row.type === 'row');

    expect(emojiRows.every((row) => row.type === 'row' && row.emojis.length <= 7)).toBe(true);
    expect(emojiRows.some((row) => row.type === 'row' && row.emojis.length === 7)).toBe(true);
  });

  it('has no empty «Недавние»: its tab leads to the very top', () => {
    const { rows, starts } = buildEmojiGrid([], 8);

    expect(starts.recent).toBe(0);
    expect(rows[0]).toMatchObject({ type: 'header', title: 'Смайлы и эмоции' });
  });
});
