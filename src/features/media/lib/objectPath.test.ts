import { buildAvatarPath, buildObjectPath, ownAvatarPathFromUrl } from './objectPath';

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

describe('avatar paths', () => {
  const base = 'https://x.supabase.co/storage/v1/object/public/media/';

  it('puts avatars into the owner avatar folder', () => {
    expect(buildAvatarPath('user-1')).toMatch(/^user-1\/avatar\/[a-z0-9-]+\.jpg$/);
  });

  it('recognises only the owner avatar', () => {
    expect(ownAvatarPathFromUrl(`${base}user-1/avatar/a.jpg`, 'media', 'user-1')).toBe(
      'user-1/avatar/a.jpg',
    );
    expect(ownAvatarPathFromUrl(`${base}user-1/avatar/a.jpg?t=1`, 'media', 'user-1')).toBe(
      'user-1/avatar/a.jpg',
    );
    expect(ownAvatarPathFromUrl(`${base}user-2/avatar/a.jpg`, 'media', 'user-1')).toBeNull();
    expect(ownAvatarPathFromUrl(`${base}user-1/photo/a.jpg`, 'media', 'user-1')).toBeNull();
    expect(ownAvatarPathFromUrl('https://lh3.googleusercontent.com/a/xyz', 'media', 'user-1')).toBeNull();
  });
});
