import * as ImagePicker from 'expo-image-picker';

import { compressImage } from './lib/compressImage';
import { captureMediaWithSystemCamera, pickMediaFromLibrary } from './pickMedia';

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));

jest.mock('./lib/compressImage', () => ({
  compressImage: jest.fn((media) => Promise.resolve({ ...media, uri: 'file:///cache/small.jpg' })),
}));

const photoAsset = {
  uri: 'file:///cache/IMG_0001.HEIC',
  width: 4032,
  height: 3024,
  type: 'image' as const,
  mimeType: 'image/heic',
  duration: null,
};

const videoAsset = {
  uri: 'file:///cache/IMG_0002.mov',
  width: 1920,
  height: 1080,
  type: 'video' as const,
  duration: 12_000,
};

beforeEach(() => {
  jest.clearAllMocks();
  (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({
    granted: true,
  });
  (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
});

describe('pickMediaFromLibrary', () => {
  it('returns null without opening the picker when permission is refused', async () => {
    (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: false,
    });

    await expect(pickMediaFromLibrary()).resolves.toBeNull();
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('returns null when the user cancels', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: true });

    await expect(pickMediaFromLibrary()).resolves.toBeNull();
  });

  it('compresses a picked photo before handing it back', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [photoAsset],
    });

    const result = await pickMediaFromLibrary();

    expect(compressImage).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      expect.objectContaining({ kind: 'photo', uri: 'file:///cache/small.jpg' }),
    ]);
  });

  it('passes a video through untouched and keeps its duration', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [videoAsset],
    });

    const result = await pickMediaFromLibrary();

    expect(compressImage).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        kind: 'video',
        uri: 'file:///cache/IMG_0002.mov',
        mimeType: 'video/quicktime',
        width: 1920,
        height: 1080,
        durationMs: 12_000,
      },
    ]);
  });
});

describe('captureMediaWithSystemCamera', () => {
  it('returns null without opening the camera when permission is refused', async () => {
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });

    await expect(captureMediaWithSystemCamera()).resolves.toBeNull();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('compresses a captured photo', async () => {
    (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [photoAsset],
    });

    const result = await captureMediaWithSystemCamera();

    expect(result).toEqual([
      expect.objectContaining({ kind: 'photo', uri: 'file:///cache/small.jpg' }),
    ]);
  });
});
