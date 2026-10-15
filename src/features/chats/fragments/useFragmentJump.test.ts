import { quoteRange } from './useFragmentJump';

jest.mock('@/api/supabase', () => ({ supabase: {} }));

describe('where the quoted piece is in the bubble text', () => {
  const text = 'Самойлова, ты дура! И ещё раз: ты дура!';

  it('takes the place the base gave when the text there is the quote', () => {
    expect(quoteRange(text, 'ты дура!', 11, 19)).toEqual({ start: 11, end: 19 });
  });

  it('finds the same quote nearest to that place when the text lags behind an edit', () => {
    // База уже сдвинула фрагмент на 5, а в переписке ещё старый текст.
    expect(quoteRange(text, 'ты дура!', 16, 24)).toEqual({ start: 11, end: 19 });
    expect(quoteRange(text, 'ты дура!', 30, 38)).toEqual({ start: 31, end: 39 });
  });

  it('counts the base offsets in code points, not UTF-16', () => {
    // Эмодзи — одна кодовая точка, но два символа UTF-16.
    expect(quoteRange('🔥 привет мир', 'мир', 9, 12)).toEqual({ start: 10, end: 13 });
  });

  it('has nothing to show when the quote is gone from the text', () => {
    expect(quoteRange(text, 'другой уровень', 0, 14)).toBeNull();
  });
});
