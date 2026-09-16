import { buildObjectPath } from './objectPath';

describe('buildObjectPath', () => {
  it('scopes the object to the owner and names it by media kind', () => {
    const path = buildObjectPath('user-1', 'voice', 'audio/mp4');

    expect(path).toMatch(/^user-1\/voice\/[a-z0-9-]+\.m4a$/);
  });

  it('does not reuse a path for two uploads', () => {
    const first = buildObjectPath('user-1', 'photo', 'image/jpeg');
    const second = buildObjectPath('user-1', 'photo', 'image/jpeg');

    expect(first).not.toBe(second);
  });
});
