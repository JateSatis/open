import { ImageManipulator } from 'expo-image-manipulator';

import { compressImage } from './compressImage';

import { MediaLimits } from '@/features/media/constants';
import type { LocalMedia } from '@/features/media/types';

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: 'jpeg' },
}));

const resize = jest.fn();
const saveAsync = jest.fn();

const original: LocalMedia = {
  kind: 'photo',
  uri: 'file:///cache/original.heic',
  mimeType: 'image/heic',
  width: 4032,
  height: 3024,
  durationMs: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  saveAsync.mockResolvedValue({ uri: 'file:///cache/small.jpg', width: 1600, height: 1200 });
  const context = {
    resize: resize.mockReturnThis(),
    renderAsync: jest.fn().mockResolvedValue({ saveAsync }),
  };
  (ImageManipulator.manipulate as jest.Mock).mockReturnValue(context);
});

describe('compressImage', () => {
  it('resizes an oversized photo down to the traffic limit', async () => {
    await compressImage(original);

    expect(resize).toHaveBeenCalledWith({ width: MediaLimits.photo.maxWidthPx, height: null });
  });

  it('returns the compressed file with its new dimensions and type', async () => {
    const result = await compressImage(original);

    expect(result).toEqual({
      kind: 'photo',
      uri: 'file:///cache/small.jpg',
      mimeType: 'image/jpeg',
      width: 1600,
      height: 1200,
      durationMs: null,
    });
  });

  it('does not upscale a photo that is already small', async () => {
    saveAsync.mockResolvedValue({ uri: 'file:///cache/small.jpg', width: 800, height: 600 });

    await compressImage({ ...original, width: 800, height: 600 });

    expect(resize).not.toHaveBeenCalled();
  });

  it('still re-encodes when the size is unknown', async () => {
    await compressImage({ ...original, width: null, height: null });

    expect(resize).not.toHaveBeenCalled();
    expect(saveAsync).toHaveBeenCalledWith({
      compress: MediaLimits.photo.quality,
      format: 'jpeg',
    });
  });
});
