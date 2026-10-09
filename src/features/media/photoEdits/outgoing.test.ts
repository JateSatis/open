import { outgoingLocalMedia, outgoingPreview, type OutgoingMedia } from './outgoing';

jest.mock('../mediaLibrary', () => ({
  resolveLibraryAsset: jest.fn((asset) => Promise.resolve({ ...asset, uri: 'file:///orig.jpg' })),
  libraryAssetToLocalMedia: jest.fn((asset) => ({
    kind: asset.kind,
    uri: asset.uri,
    mimeType: 'image/jpeg',
    width: asset.width,
    height: asset.height,
    durationMs: null,
  })),
}));

const PHOTO: OutgoingMedia = {
  id: 'content://media/1',
  kind: 'photo',
  width: 4000,
  height: 3000,
  durationMs: null,
};

const BAKED = { uri: 'file:///edited.jpg', width: 1600, height: 1200 };

describe('итоговый файл выбранного', () => {
  it('неотредактированное: превью по id, байты — оригинал', async () => {
    expect(outgoingPreview(PHOTO)).toEqual({ url: PHOTO.id, width: 4000, height: 3000 });
    expect(await outgoingLocalMedia(PHOTO)).toMatchObject({ uri: 'file:///orig.jpg' });
  });

  it('отредактированное: и превью, и байты — запечённый файл, без пережатия', async () => {
    const edited = { ...PHOTO, edited: { file: () => BAKED } };

    expect(outgoingPreview(edited)).toEqual({ url: BAKED.uri, width: 1600, height: 1200 });
    expect(await outgoingLocalMedia(edited)).toEqual({
      kind: 'photo',
      uri: BAKED.uri,
      mimeType: 'image/jpeg',
      width: 1600,
      height: 1200,
      durationMs: null,
      prepared: true,
    });
  });

  it('сбой запекания — не оригинал: превью пустое, загрузка падает', async () => {
    const broken = {
      ...PHOTO,
      edited: {
        file: () => {
          throw new Error('нет рабочей копии');
        },
      },
    };

    expect(outgoingPreview(broken).url).toBe('');
    await expect(outgoingLocalMedia(broken)).rejects.toThrow('нет рабочей копии');
  });
});
