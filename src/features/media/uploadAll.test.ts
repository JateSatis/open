import { uploadAllMedia } from './uploadAll';
import { uploadMedia, removeUploadedMedia } from './storage';
import type { LocalMedia, UploadedMedia } from './types';

jest.mock('./lib/prepareForUpload', () => ({
  prepareForUpload: jest.fn((media: LocalMedia) => Promise.resolve(media)),
}));
jest.mock('./storage', () => ({
  uploadMedia: jest.fn(),
  removeUploadedMedia: jest.fn(),
}));

const mockedUpload = uploadMedia as jest.MockedFunction<typeof uploadMedia>;
const mockedRemove = removeUploadedMedia as jest.MockedFunction<typeof removeUploadedMedia>;

function media(id: string): LocalMedia {
  return {
    kind: 'photo',
    uri: `file:///cache/${id}.jpg`,
    mimeType: 'image/jpeg',
    width: 100,
    height: 100,
    durationMs: null,
  };
}

function uploaded(id: string): UploadedMedia {
  return {
    kind: 'photo',
    url: `https://cdn.example/${id}.jpg`,
    path: `user-1/photo/${id}.jpg`,
    mimeType: 'image/jpeg',
    width: 100,
    height: 100,
    durationMs: null,
    sizeBytes: 10,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedRemove.mockResolvedValue(true);
});

describe('uploadAllMedia', () => {
  it('uploads every file and keeps the original order', async () => {
    mockedUpload.mockImplementation((item) =>
      Promise.resolve(uploaded(item.uri.replace('file:///cache/', '').replace('.jpg', ''))),
    );

    const result = await uploadAllMedia([media('a'), media('b'), media('c')], 'user-1');

    expect(result.map((item) => item.path)).toEqual([
      'user-1/photo/a.jpg',
      'user-1/photo/b.jpg',
      'user-1/photo/c.jpg',
    ]);
  });

  it('removes every file already uploaded when one of them fails', async () => {
    mockedUpload
      .mockResolvedValueOnce(uploaded('a'))
      .mockResolvedValueOnce(uploaded('b'))
      .mockRejectedValueOnce(new Error('сеть пропала'));

    await expect(uploadAllMedia([media('a'), media('b'), media('c')], 'user-1')).rejects.toThrow(
      'сеть пропала',
    );

    // Сообщение с частью вложений в базу не попадёт — загруженные объекты
    // не должны остаться висеть в бакете без ссылки на них.
    expect(mockedRemove).toHaveBeenCalledWith('user-1/photo/a.jpg');
    expect(mockedRemove).toHaveBeenCalledWith('user-1/photo/b.jpg');
    expect(mockedRemove).toHaveBeenCalledTimes(2);
  });

  it('does nothing for an empty album', async () => {
    const result = await uploadAllMedia([], 'user-1');

    expect(result).toEqual([]);
    expect(mockedUpload).not.toHaveBeenCalled();
  });
});
