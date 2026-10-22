import {
  buildStagingPath,
  ownAvatarPath,
  ownAvatarPathFromUrl,
  ownPathFromUrl,
} from './objectPath';

describe('buildStagingPath', () => {
  // Такой же шаблон ждёт sanitize-media: папка — сам загрузивший.
  it('scopes the staged object to the owner folder', () => {
    expect(buildStagingPath('user-1', 'audio/mp4')).toMatch(/^user-1\/[A-Za-z0-9_-]+\.m4a$/);
  });

  it('does not reuse a path for two uploads', () => {
    expect(buildStagingPath('user-1', 'image/jpeg')).not.toBe(buildStagingPath('user-1', 'image/jpeg'));
  });
});

describe('avatar paths', () => {
  const base = 'https://x.supabase.co/storage/v1/object/public/media/';

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
