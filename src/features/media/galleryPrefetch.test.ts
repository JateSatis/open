import { getGallerySnapshot, prefetchGallery, resetGallerySnapshot } from './galleryPrefetch';
import { checkMediaLibraryAccess, countRecentMedia, queryRecentMedia } from './mediaLibrary';

jest.mock('./mediaLibrary', () => ({
  checkMediaLibraryAccess: jest.fn(),
  countRecentMedia: jest.fn(),
  queryRecentMedia: jest.fn(),
}));

const access = checkMediaLibraryAccess as jest.MockedFunction<typeof checkMediaLibraryAccess>;
const count = countRecentMedia as jest.MockedFunction<typeof countRecentMedia>;
const query = queryRecentMedia as jest.MockedFunction<typeof queryRecentMedia>;

function asset(id: string) {
  return { id, kind: 'photo' as const, width: 1, height: 1, durationMs: null };
}

/** Дождаться, пока отработает фоновое чтение. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  jest.clearAllMocks();
  resetGallerySnapshot();
});

describe('prefetchGallery', () => {
  it('reads nothing and never asks for access when it has not been granted', async () => {
    access.mockResolvedValue('denied');

    prefetchGallery();
    await settle();

    expect(query).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
    expect(getGallerySnapshot()).toBeNull();
  });

  it('keeps the head of the gallery ready for the sheet once access is there', async () => {
    access.mockResolvedValue('granted');
    count.mockResolvedValue(3346);
    query.mockResolvedValue(Array.from({ length: 120 }, (_, i) => asset(String(i))));

    prefetchGallery();
    await settle();

    expect(getGallerySnapshot()?.items).toHaveLength(120);
    expect(getGallerySnapshot()?.total).toBe(3346);
  });

  it('knows the exact length when the whole gallery fits into the first chunk', async () => {
    access.mockResolvedValue('granted');
    count.mockResolvedValue(null);
    query.mockResolvedValue([asset('a'), asset('b')]);

    prefetchGallery();
    await settle();

    expect(getGallerySnapshot()?.total).toBe(2);
  });

  it('reads the gallery once, however many chats are opened', async () => {
    access.mockResolvedValue('granted');
    count.mockResolvedValue(1);
    query.mockResolvedValue([asset('a')]);

    prefetchGallery();
    prefetchGallery();
    await settle();
    prefetchGallery();
    await settle();

    expect(query).toHaveBeenCalledTimes(1);
  });
});
