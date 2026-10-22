import {
  forgetAvatarUrls,
  isAvatarPath,
  requestAvatarUrl,
  signedAvatarUrl,
  subscribeAvatarUrls,
} from './avatars';

import { supabase } from '@/api/supabase';

jest.unmock('@/api/avatars');
jest.mock('@/api/supabase', () => ({
  supabase: { storage: { from: jest.fn() } },
}));

const storageFrom = supabase.storage.from as unknown as jest.Mock;
const createSignedUrls = jest.fn();

/** Дождаться пачки: подпись уходит в следующем такте, клиент и ответ — промисами. */
async function settle() {
  for (let tick = 0; tick < 5; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  forgetAvatarUrls();
  storageFrom.mockReturnValue({ createSignedUrls });
});

describe('avatar paths', () => {
  it('путь в бакете отличает от адреса', () => {
    expect(isAvatarPath('user-1/a.jpg')).toBe(true);
    expect(isAvatarPath('https://lh3.googleusercontent.com/a/x')).toBe(false);
    expect(isAvatarPath('file:///cache/a.jpg')).toBe(false);
    expect(isAvatarPath(null)).toBe(false);
  });

  it('пути одного такта подписываются одним запросом к закрытому бакету', async () => {
    createSignedUrls.mockResolvedValue({
      data: [
        { path: 'u1/a.jpg', signedUrl: 'https://signed/a', error: null },
        { path: 'u2/b.jpg', signedUrl: null, error: 'Object not found' },
      ],
      error: null,
    });
    const listener = jest.fn();
    const unsubscribe = subscribeAvatarUrls(listener);

    requestAvatarUrl('u1/a.jpg');
    requestAvatarUrl('u2/b.jpg');
    requestAvatarUrl('u1/a.jpg');
    await settle();

    expect(storageFrom).toHaveBeenCalledWith('avatars');
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(['u1/a.jpg', 'u2/b.jpg'], 3600);
    expect(signedAvatarUrl('u1/a.jpg')).toBe('https://signed/a');
    // Фото скрыто от меня — Storage не подписал, на месте фото заглушка.
    expect(signedAvatarUrl('u2/b.jpg')).toBeNull();
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('живую ссылку повторно не подписывает, а забытую — подписывает снова', async () => {
    createSignedUrls.mockResolvedValue({
      data: [{ path: 'u1/a.jpg', signedUrl: 'https://signed/a', error: null }],
      error: null,
    });

    requestAvatarUrl('u1/a.jpg');
    await settle();
    requestAvatarUrl('u1/a.jpg');
    await settle();
    expect(createSignedUrls).toHaveBeenCalledTimes(1);

    forgetAvatarUrls();
    expect(signedAvatarUrl('u1/a.jpg')).toBeNull();
    requestAvatarUrl('u1/a.jpg');
    await settle();
    expect(createSignedUrls).toHaveBeenCalledTimes(2);
  });
});
