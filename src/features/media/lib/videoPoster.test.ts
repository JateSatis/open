import { getThumbnailAsync } from 'expo-video-thumbnails';

import { compressImage } from './compressImage';
import { withVideoPoster } from './videoPoster';

import type { LocalMedia } from '@/features/media/types';

jest.mock('expo-video-thumbnails', () => ({ getThumbnailAsync: jest.fn() }));
jest.mock('./compressImage', () => ({ compressImage: jest.fn() }));

const mockedThumbnail = getThumbnailAsync as jest.MockedFunction<typeof getThumbnailAsync>;
const mockedCompress = compressImage as jest.MockedFunction<typeof compressImage>;

// Портретное видео с камеры Android: медиатека отдала размеры без поворота.
const video: LocalMedia = {
  kind: 'video',
  uri: 'file:///cache/clip.mp4',
  mimeType: 'video/mp4',
  width: 1920,
  height: 1080,
  durationMs: 4000,
};

beforeEach(() => jest.clearAllMocks());

describe('withVideoPoster', () => {
  it('attaches a compressed first frame and takes the size from it, rotation applied', async () => {
    mockedThumbnail.mockResolvedValue({ uri: 'file:///cache/frame.jpg', width: 720, height: 1280 });
    mockedCompress.mockImplementation((media) =>
      Promise.resolve({ ...media, uri: 'file:///cache/poster.jpg' }),
    );

    const result = await withVideoPoster(video);

    expect(mockedThumbnail).toHaveBeenCalledWith(video.uri, expect.objectContaining({ time: 0 }));
    expect(result).toEqual({
      ...video,
      posterUri: 'file:///cache/poster.jpg',
      width: 720,
      height: 1280,
    });
  });

  it('sends the video without a poster when the frame cannot be taken', async () => {
    mockedThumbnail.mockRejectedValue(new Error('unsupported codec'));

    await expect(withVideoPoster(video)).resolves.toEqual(video);
  });
});
