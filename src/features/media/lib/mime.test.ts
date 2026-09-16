import { extensionFromMime, mimeFromUri } from './mime';

describe('extensionFromMime', () => {
  it('maps known types to their storage extension', () => {
    expect(extensionFromMime('image/jpeg')).toBe('jpg');
    expect(extensionFromMime('audio/mp4')).toBe('m4a');
    expect(extensionFromMime('VIDEO/MP4')).toBe('mp4');
  });

  it('falls back to bin instead of guessing an unknown type', () => {
    expect(extensionFromMime('application/x-unknown')).toBe('bin');
  });
});

describe('mimeFromUri', () => {
  it('derives the type from the extension', () => {
    expect(mimeFromUri('file:///cache/photo.HEIC', 'image/jpeg')).toBe('image/heic');
  });

  it('ignores a query string', () => {
    expect(mimeFromUri('file:///cache/clip.mov?v=2', 'video/mp4')).toBe('video/quicktime');
  });

  it('uses the fallback for an unrecognised or missing extension', () => {
    expect(mimeFromUri('file:///cache/blob', 'video/mp4')).toBe('video/mp4');
    expect(mimeFromUri('file:///cache/blob.xyz', 'video/mp4')).toBe('video/mp4');
  });
});
