import {
  buildAvatarPath,
  buildGroupAvatarPath,
  buildObjectPath,
  ownAvatarPath,
  ownAvatarPathFromUrl,
  ownPathFromUrl,
} from './objectPath';

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

  it('puts avatars into the owner folder of the private bucket', () => {
    expect(buildAvatarPath('user-1')).toMatch(/^user-1\/[a-z0-9-]+\.jpg$/);
  });

  it('recognises only the own avatar path, never an address', () => {
    expect(ownAvatarPath('user-1/a.jpg', 'user-1')).toBe('user-1/a.jpg');
    expect(ownAvatarPath('user-2/a.jpg', 'user-1')).toBeNull();
    expect(ownAvatarPath(`${base}user-1/avatar/a.jpg`, 'user-1')).toBeNull();
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

describe('group avatar paths', () => {
  const base = 'https://x.supabase.co/storage/v1/object/public/media/';

  // Такой же шаблон проверяет база (clean_group_avatar_url): путь вне него она не примет.
  it('puts group avatars into the owner group-avatar folder', () => {
    expect(buildGroupAvatarPath('user-1')).toMatch(/^user-1\/group-avatar\/[A-Za-z0-9_-]+\.jpg$/);
  });

  it('recognises only own group avatars', () => {
    expect(ownPathFromUrl(`${base}user-1/group-avatar/g.jpg`, 'media', 'user-1', 'group-avatar')).toBe(
      'user-1/group-avatar/g.jpg',
    );
    // Фото, поставленное другим участником, — его файл.
    expect(
      ownPathFromUrl(`${base}user-2/group-avatar/g.jpg`, 'media', 'user-1', 'group-avatar'),
    ).toBeNull();
    // Аватар профиля — не фото группы.
    expect(ownPathFromUrl(`${base}user-1/avatar/a.jpg`, 'media', 'user-1', 'group-avatar')).toBeNull();
  });
});
