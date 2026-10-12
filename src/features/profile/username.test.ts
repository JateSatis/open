import {
  displayNameOf,
  formatUsername,
  normalizeUsernameInput,
  validateUsername,
} from './username';

describe('validateUsername', () => {
  it('accepts a plain lowercase handle', () => {
    expect(validateUsername('maxim_99')).toBeNull();
  });

  it('accepts an empty field: a username is optional for people and groups', () => {
    expect(validateUsername('   ')).toBeNull();
  });

  it('asks for a username when it is required (a channel)', () => {
    expect(validateUsername('   ', { required: true })).toBe('Придумайте имя пользователя');
  });

  it.each(['a.b', 'news.ch', 'team.di', '.abc'])('rejects %s for the dot', (value) => {
    expect(validateUsername(value)).toBe('Точка в имени недопустима');
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
    expect(formatUsername(null, 'group')).toBeNull();
  });

  it('adds the kind suffix: .ch for a channel, .di for a group, nothing for a person', () => {
    expect(formatUsername('max', 'channel')).toBe('@max.ch');
    expect(formatUsername('max', 'group')).toBe('@max.di');
    expect(formatUsername('max', 'profile')).toBe('@max');
  });
});

describe('normalizeUsernameInput', () => {
  it('drops a pasted @ and the suffix of its own kind', () => {
    expect(normalizeUsernameInput('@news.ch', 'channel')).toBe('news');
    expect(normalizeUsernameInput('team.DI', 'group')).toBe('team');
  });

  it('keeps a foreign suffix so the dot error shows', () => {
    expect(normalizeUsernameInput('news.di', 'channel')).toBe('news.di');
    expect(normalizeUsernameInput('max.ch', 'profile')).toBe('max.ch');
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
