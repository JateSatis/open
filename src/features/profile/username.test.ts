import { displayNameOf, formatUsername, validateUsername } from './username';

describe('validateUsername', () => {
  it('accepts a plain lowercase handle', () => {
    expect(validateUsername('maxim_99')).toBeNull();
  });

  it('asks for a username when the field is empty', () => {
    expect(validateUsername('   ')).toBe('Придумайте имя пользователя');
  });

  it('rejects a handle that is too short', () => {
    expect(validateUsername('ab')).toBe('Минимум 3 символа');
  });

  it('rejects a handle that is too long', () => {
    expect(validateUsername('a'.repeat(21))).toBe('Максимум 20 символов');
  });

  it.each(['Maxim', 'максим', '9lives', 'with space', 'has-dash'])(
    'rejects %s as an alphabet violation',
    (value) => {
      expect(validateUsername(value)).toBe(
        'Только латиница в нижнем регистре, цифры и _, начиная с буквы',
      );
    },
  );
});

describe('formatUsername', () => {
  it('prefixes a set username with @', () => {
    expect(formatUsername('maxim')).toBe('@maxim');
  });

  it('returns null when the username is not set yet', () => {
    expect(formatUsername(null)).toBeNull();
  });
});

describe('displayNameOf', () => {
  it('prefers the display name', () => {
    expect(displayNameOf({ displayName: 'Максим', username: 'maxim' })).toBe('Максим');
  });

  it('falls back to the username when there is no display name', () => {
    expect(displayNameOf({ displayName: null, username: 'maxim' })).toBe('maxim');
  });

  it('falls back to a placeholder when neither is set', () => {
    expect(displayNameOf({ displayName: '  ', username: null })).toBe('Без имени');
  });
});
