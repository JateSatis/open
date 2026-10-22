import { Video } from 'react-native-compressor';

import { compressVideo, VideoPrepareError } from './compressVideo';

import type { LocalMedia } from '@/features/media/types';

jest.mock('react-native-compressor', () => ({ Video: { compress: jest.fn() } }));

const compress = Video.compress as jest.Mock;

const video: LocalMedia = {
  kind: 'video',
  uri: 'file:///gallery/clip.mov',
  mimeType: 'video/quicktime',
  width: 1920,
  height: 1080,
  durationMs: 4000,
};

beforeEach(() => jest.clearAllMocks());

describe('compressVideo', () => {
  it('sends the re-encoded file, not the gallery original', async () => {
    compress.mockResolvedValue('file:///cache/clip-small.mp4');

    await expect(compressVideo(video)).resolves.toEqual({
      ...video,
      uri: 'file:///cache/clip-small.mp4',
      mimeType: 'video/mp4',
    });
  });

  // К1.2: при сбое сжатия оригинал с геометкой и данными камеры не уходит.
  it('refuses instead of falling back to the original when compression fails', async () => {
    compress.mockRejectedValue(new Error('unknown codec'));

    await expect(compressVideo(video)).rejects.toBeInstanceOf(VideoPrepareError);
  });

  it('leaves non-video media alone', async () => {
    const voice = { ...video, kind: 'voice' as const };

    await expect(compressVideo(voice)).resolves.toBe(voice);
    expect(compress).not.toHaveBeenCalled();
  });
});
