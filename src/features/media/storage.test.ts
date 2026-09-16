import { File } from 'expo-file-system';

import { MediaUploadError, removeUploadedMedia, uploadMedia } from './storage';
import type { LocalMedia } from './types';

import { supabase } from '@/api/supabase';

jest.mock('expo-file-system', () => ({ File: jest.fn() }));

const upload = jest.fn();
const getPublicUrl = jest.fn();
const remove = jest.fn();

jest.mock('@/api/supabase', () => ({
  supabase: { storage: { from: jest.fn() } },
}));

const FileMock = File as unknown as jest.Mock;

const photo: LocalMedia = {
  kind: 'photo',
  uri: 'file:///cache/photo.jpg',
  mimeType: 'image/jpeg',
  width: 1600,
  height: 900,
  durationMs: null,
};

function mockFile(overrides: { exists?: boolean; size?: number } = {}) {
  FileMock.mockImplementation(() => ({
    exists: overrides.exists ?? true,
    size: overrides.size ?? 2048,
    arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFile();
  upload.mockResolvedValue({ error: null });
  getPublicUrl.mockReturnValue({ data: { publicUrl: 'https://cdn.test/media/user-1/photo/a.jpg' } });
  remove.mockResolvedValue({ error: null });
  (supabase.storage.from as jest.Mock).mockReturnValue({ upload, getPublicUrl, remove });
});

describe('uploadMedia', () => {
  it('returns the public URL and the metadata attachments needs', async () => {
    const result = await uploadMedia(photo, 'user-1');

    expect(result).toEqual({
      kind: 'photo',
      url: 'https://cdn.test/media/user-1/photo/a.jpg',
      path: expect.stringMatching(/^user-1\/photo\/.+\.jpg$/),
      mimeType: 'image/jpeg',
      width: 1600,
      height: 900,
      durationMs: null,
      sizeBytes: 2048,
    });
  });

  it('uploads the bytes into the uploader own prefix with the right content type', async () => {
    await uploadMedia(photo, 'user-1');

    const [path, body, options] = upload.mock.calls[0];

    expect(path.startsWith('user-1/')).toBe(true);
    expect(body).toBeInstanceOf(ArrayBuffer);
    expect(options).toEqual({ contentType: 'image/jpeg', upsert: false });
  });

  it('fails before touching the network when the file is gone', async () => {
    mockFile({ exists: false });

    await expect(uploadMedia(photo, 'user-1')).rejects.toThrow(MediaUploadError);
    expect(upload).not.toHaveBeenCalled();
  });

  it('surfaces a storage failure as MediaUploadError', async () => {
    upload.mockResolvedValue({ error: { message: 'quota exceeded' } });

    await expect(uploadMedia(photo, 'user-1')).rejects.toThrow('quota exceeded');
  });
});

describe('removeUploadedMedia', () => {
  it('reports success when the object is deleted', async () => {
    await expect(removeUploadedMedia('user-1/photo/a.jpg')).resolves.toBe(true);
    expect(remove).toHaveBeenCalledWith(['user-1/photo/a.jpg']);
  });

  it('reports failure instead of throwing over a lost cleanup', async () => {
    remove.mockResolvedValue({ error: { message: 'not found' } });

    await expect(removeUploadedMedia('user-1/photo/a.jpg')).resolves.toBe(false);
  });
});
