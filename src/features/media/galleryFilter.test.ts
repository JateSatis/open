import { matchesGalleryFilter, type MediaLibraryItem } from './mediaLibrary';

jest.mock('expo-media-library', () => ({
  AssetField: {},
  MediaType: { IMAGE: 'photo', VIDEO: 'video' },
}));
jest.mock('expo-media-library/legacy', () => ({}));

const photo: MediaLibraryItem = { id: 'p', kind: 'photo', width: 1, height: 1, durationMs: null };
const video = (durationMs: number | null): MediaLibraryItem => ({
  id: 'v',
  kind: 'video',
  width: 1,
  height: 1,
  durationMs,
});

describe('matchesGalleryFilter', () => {
  it('keeps everything without a filter', () => {
    expect(matchesGalleryFilter(photo, undefined)).toBe(true);
    expect(matchesGalleryFilter(video(500_000), undefined)).toBe(true);
  });

  it('shows only photos to a photo-only sheet', () => {
    expect(matchesGalleryFilter(photo, { kind: 'photo' })).toBe(true);
    expect(matchesGalleryFilter(video(1000), { kind: 'photo' })).toBe(false);
  });

  it('drops long videos but keeps the ones whose length is unknown', () => {
    const pops = { kind: 'video' as const, maxDurationMs: 90_000 };

    expect(matchesGalleryFilter(video(90_000), pops)).toBe(true);
    expect(matchesGalleryFilter(video(90_001), pops)).toBe(false);
    expect(matchesGalleryFilter(video(null), pops)).toBe(true);
    expect(matchesGalleryFilter(photo, pops)).toBe(false);
  });
});
