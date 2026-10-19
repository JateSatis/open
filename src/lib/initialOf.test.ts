import { initialOf } from './initialOf';

describe('initialOf', () => {
  it('takes the first letter in upper case', () => {
    expect(initialOf('  максим')).toBe('М');
  });

  it('keeps a leading emoji whole', () => {
    expect(initialOf('😀Max')).toBe('😀');
  });

  it('falls back to a question mark', () => {
    expect(initialOf('   ')).toBe('?');
  });
});
