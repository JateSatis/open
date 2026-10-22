import { File } from 'expo-file-system';
import { FunctionsHttpError } from '@supabase/supabase-js';

import {
  MediaUploadError,
  removePublicMedia,
  removeUploadedMedia,
  storedPaths,
  uploadAvatar,
  uploadGroupAvatar,
  uploadMedia,
  uploadPopMedia,
} from './storage';
import type { LocalMedia } from './types';

import { supabase } from '@/api/supabase';

jest.mock('expo-file-system', () => ({ File: jest.fn() }));

const upload = jest.fn();
const remove = jest.fn();
const invoke = jest.fn();

jest.mock('@/api/supabase', () => ({
  supabase: { storage: { from: jest.fn() }, functions: { invoke: jest.fn() } },
}));

const FileMock = File as unknown as jest.Mock;
const storageFrom = supabase.storage.from as jest.Mock;

const photo: LocalMedia = {
  kind: 'photo',
  uri: 'file:///cache/photo.jpg',
  mimeType: 'image/jpeg',
  width: 1600,
  height: 900,
  durationMs: null,
};

const video: LocalMedia = {
  kind: 'video',
  uri: 'file:///cache/clip.mp4',
  mimeType: 'video/mp4',
  width: 720,
  height: 1280,
  durationMs: 4000,
  posterUri: 'file:///cache/clip.jpg',
};

function mockFile(overrides: { exists?: boolean } = {}) {
  FileMock.mockImplementation(() => ({
    exists: overrides.exists ?? true,
    size: 2048,
    arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
  }));
}

/** Ответ sanitize-media: чистый файл на постоянном месте. */
function sanitized(path: string, url = path) {
  return { data: { path, url, size_bytes: 1000 }, error: null };
}

function refused(status: number) {
  return {
    data: null,
    error: new FunctionsHttpError(new Response('{}', { status })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFile();
  upload.mockResolvedValue({ error: null });
  remove.mockResolvedValue({ error: null });
  storageFrom.mockReturnValue({ upload, remove });
  (supabase.functions.invoke as jest.Mock).mockImplementation(invoke);
  invoke.mockImplementation(async (_name: string, { body }: { body: { kind: string } }) =>
    sanitized(`user-1/${body.kind}/clean.jpg`),
  );
});

describe('uploadMedia', () => {
  it('stages the file in the uploader own folder and has it cleaned before use', async () => {
    const result = await uploadMedia(photo, 'user-1');

    expect(storageFrom).toHaveBeenCalledWith('uploads');

    const [staged, body, options] = upload.mock.calls[0];

    expect(staged).toMatch(/^user-1\/[A-Za-z0-9_-]+\.jpg$/);
    expect(body).toBeInstanceOf(ArrayBuffer);
    expect(options).toEqual({ contentType: 'image/jpeg', upsert: false });
    expect(invoke).toHaveBeenCalledWith('sanitize-media', {
      body: { path: staged, kind: 'photo' },
    });
    // В сообщение уходит путь чистого файла, а не адрес и не временный файл.
    expect(result).toEqual({
      kind: 'photo',
      url: 'user-1/photo/clean.jpg',
      path: 'user-1/photo/clean.jpg',
      posterUrl: null,
      posterPath: null,
      mimeType: 'image/jpeg',
      width: 1600,
      height: 900,
      durationMs: null,
      sizeBytes: 1000,
      waveform: null,
    });
  });

  it('fails before touching the network when the file is gone', async () => {
    mockFile({ exists: false });

    await expect(uploadMedia(photo, 'user-1')).rejects.toThrow(MediaUploadError);
    expect(upload).not.toHaveBeenCalled();
  });

  it('a file that cannot be cleaned is not published, and says so', async () => {
    invoke.mockResolvedValue(refused(422));

    const failure = uploadMedia(photo, 'user-1');

    await expect(failure).rejects.toThrow(MediaUploadError);
    await expect(failure).rejects.toMatchObject({ reason: 'unsupported' });
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0]]);
  });

  it('a failed cleaning call is an ordinary upload error', async () => {
    invoke.mockResolvedValue(refused(500));

    await expect(uploadMedia(photo, 'user-1')).rejects.toMatchObject({ reason: 'failed' });
  });

  it('surfaces a storage failure as MediaUploadError', async () => {
    upload.mockResolvedValue({ error: { message: 'quota exceeded' } });

    await expect(uploadMedia(photo, 'user-1')).rejects.toThrow('quota exceeded');
    expect(invoke).not.toHaveBeenCalled();
  });

  describe('video with a poster', () => {
    it('cleans the poster as a poster and returns both', async () => {
      const result = await uploadMedia(video, 'user-1');

      expect(invoke.mock.calls.map(([, { body }]) => body.kind)).toEqual(['video', 'poster']);
      expect(result.path).toBe('user-1/video/clean.jpg');
      expect(result.posterPath).toBe('user-1/poster/clean.jpg');
      expect(result.posterUrl).toBe(result.posterPath);
    });

    it('removes the cleaned video when its poster fails, leaving nothing orphaned', async () => {
      upload
        .mockResolvedValueOnce({ error: null })
        .mockResolvedValueOnce({ error: { message: 'quota exceeded' } });

      await expect(uploadMedia(video, 'user-1')).rejects.toThrow('quota exceeded');

      expect(storageFrom).toHaveBeenCalledWith('chat-media');
      expect(remove).toHaveBeenCalledWith(['user-1/video/clean.jpg']);
    });

    it('lists the poster among the stored paths for a later cleanup', () => {
      expect(storedPaths({ path: 'a.mp4', posterPath: 'a.jpg' })).toEqual(['a.mp4', 'a.jpg']);
      expect(storedPaths({ path: 'b.jpg', posterPath: null })).toEqual(['b.jpg']);
    });
  });
});

describe('pops, avatars and group photos', () => {
  it('a pop is cleaned as a pop video and a pop poster', async () => {
    invoke.mockImplementation(async (_name: string, { body }: { body: { kind: string } }) =>
      sanitized(`user-1/pops/${body.kind}`, `https://cdn.test/media/user-1/pops/${body.kind}`),
    );

    const result = await uploadPopMedia(video, 'user-1');

    expect(invoke.mock.calls.map(([, { body }]) => body.kind)).toEqual(['pop_video', 'pop_poster']);
    expect(result.url).toBe('https://cdn.test/media/user-1/pops/pop_video');
  });

  it('the profile photo returns its path in the closed bucket', async () => {
    await expect(uploadAvatar('file:///a.jpg', 'user-1')).resolves.toBe('user-1/avatar/clean.jpg');
    expect(invoke.mock.calls[0][1].body.kind).toBe('avatar');
  });

  it('the group photo returns its public address', async () => {
    invoke.mockResolvedValue(sanitized('user-1/group-avatar/g.jpg', 'https://cdn.test/g.jpg'));

    await expect(uploadGroupAvatar('file:///g.jpg', 'user-1')).resolves.toEqual({
      path: 'user-1/group-avatar/g.jpg',
      url: 'https://cdn.test/g.jpg',
    });
    expect(invoke.mock.calls[0][1].body.kind).toBe('group_avatar');
  });
});

describe('removeUploadedMedia', () => {
  it('removes chat media from the closed bucket by default', async () => {
    await expect(removeUploadedMedia('user-1/photo/a.jpg')).resolves.toBe(true);
    expect(storageFrom).toHaveBeenCalledWith('chat-media');
    expect(remove).toHaveBeenCalledWith(['user-1/photo/a.jpg']);
  });

  it('removes pops and group photos from the public bucket', async () => {
    await removePublicMedia('user-1/pops/a.mp4');

    expect(storageFrom).toHaveBeenCalledWith('media');
  });

  it('reports failure instead of throwing over a lost cleanup', async () => {
    remove.mockResolvedValue({ error: { message: 'not found' } });

    await expect(removeUploadedMedia('user-1/photo/a.jpg')).resolves.toBe(false);
  });
});
