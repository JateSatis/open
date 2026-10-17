import { act, renderHook } from '@testing-library/react-native';

import { resetGallerySnapshot, setGallerySnapshot } from './galleryPrefetch';
import {
  checkMediaLibraryAccess,
  countRecentMedia,
  queryRecentMedia,
  type MediaLibraryItem,
} from './mediaLibrary';
import { useGalleryAssets } from './useGalleryAssets';

jest.mock('./mediaLibrary', () => ({
  ...jest.requireActual<object>('./mediaLibrary'),
  checkMediaLibraryAccess: jest.fn(),
  requestMediaLibraryAccess: jest.fn(),
  countRecentMedia: jest.fn(),
  queryRecentMedia: jest.fn(),
}));
jest.mock('expo-media-library', () => ({
  AssetField: {},
  MediaType: { IMAGE: 'photo', VIDEO: 'video' },
}));
jest.mock('expo-media-library/legacy', () => ({}));

const access = checkMediaLibraryAccess as jest.MockedFunction<typeof checkMediaLibraryAccess>;
const count = countRecentMedia as jest.MockedFunction<typeof countRecentMedia>;
const query = queryRecentMedia as jest.MockedFunction<typeof queryRecentMedia>;

const video = (id: string, durationMs: number | null): MediaLibraryItem => ({
  id,
  kind: 'video',
  width: 1,
  height: 1,
  durationMs,
});

const POPS = { kind: 'video' as const, maxDurationMs: 90_000 };

beforeEach(() => {
  jest.clearAllMocks();
  resetGallerySnapshot();
  access.mockResolvedValue('granted');
  count.mockResolvedValue(10);
});

describe('useGalleryAssets with a filter', () => {
  it('asks the library for videos only and leaves out the long ones', async () => {
    query.mockResolvedValue([video('short', 5000), video('long', 120_000), video('unknown', null)]);

    const { result } = await renderHook(() => useGalleryAssets(true, POPS));
    await act(async () => {});

    expect(query).toHaveBeenCalledWith(expect.objectContaining({ kind: 'video' }));
    expect(result.current.items.map((item) => item.id)).toEqual(['short', 'unknown']);
    // Скелет — по отфильтрованному списку, а не по числу видео в галерее.
    expect(result.current.total).toBe(2);
    expect(count).not.toHaveBeenCalled();
  });

  it('does not start from the shared gallery snapshot', async () => {
    setGallerySnapshot({ items: [{ ...video('photo', null), kind: 'photo' }], total: 1 });
    query.mockResolvedValue([]);

    const { result } = await renderHook(() => useGalleryAssets(true, POPS));

    expect(result.current.items).toEqual([]);
    await act(async () => {});
    expect(result.current.status).toBe('empty');
  });

  it('counts photos only for a photo-only sheet', async () => {
    query.mockResolvedValue([]);

    await renderHook(() => useGalleryAssets(true, { kind: 'photo' }));
    await act(async () => {});

    expect(count).toHaveBeenCalledWith('photo');
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ kind: 'photo' }));
  });
});
