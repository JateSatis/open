import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useRecentMedia } from './useRecentMedia';
import { queryRecentMedia, requestMediaLibraryAccess } from './mediaLibrary';

jest.mock('./mediaLibrary', () => ({
  requestMediaLibraryAccess: jest.fn(),
  queryRecentMedia: jest.fn(),
  // Загруженная страница сразу греет пути к файлам — походы в медиатеку
  // из теста наружу не выпускаем.
  resolveAssetUri: jest.fn((id: string) => Promise.resolve(`file:///${id}.jpg`)),
}));
jest.mock('./constants', () => ({
  MediaLimits: { gallery: { maxSelection: 50, pageSize: 2 } },
}));

const mockedRequestAccess = requestMediaLibraryAccess as jest.MockedFunction<
  typeof requestMediaLibraryAccess
>;
const mockedQuery = queryRecentMedia as jest.MockedFunction<typeof queryRecentMedia>;

function asset(id: string) {
  return { id, kind: 'photo' as const, uri: `file:///${id}.jpg`, width: 10, height: 10, durationMs: null };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useRecentMedia', () => {
  it('asks for access once and loads the first page when it is granted', async () => {
    mockedRequestAccess.mockResolvedValue('granted');
    mockedQuery.mockResolvedValue([asset('a'), asset('b')]);

    const { result } = await renderHook(() => useRecentMedia());

    await waitFor(() => expect(result.current.status).toBe('granted'));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(mockedQuery).toHaveBeenCalledWith({ offset: 0 });
  });

  it('does not query the library at all when access is denied', async () => {
    mockedRequestAccess.mockResolvedValue('denied');

    const { result } = await renderHook(() => useRecentMedia());

    await waitFor(() => expect(result.current.status).toBe('denied'));
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('pages further with an incrementing offset until a short page ends it', async () => {
    mockedRequestAccess.mockResolvedValue('granted');
    mockedQuery.mockResolvedValueOnce([asset('a'), asset('b')]);
    mockedQuery.mockResolvedValueOnce([asset('c')]);

    const { result } = await renderHook(() => useRecentMedia());

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.hasMore).toBe(true);

    await act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.items).toHaveLength(3));
    expect(mockedQuery).toHaveBeenLastCalledWith({ offset: 2 });
    // Страница короче размера страницы — дальше грузить нечего.
    expect(result.current.hasMore).toBe(false);
  });

  it('lets requestAccess retry after a denial', async () => {
    mockedRequestAccess.mockResolvedValueOnce('denied');

    const { result } = await renderHook(() => useRecentMedia());

    await waitFor(() => expect(result.current.status).toBe('denied'));

    mockedRequestAccess.mockResolvedValueOnce('granted');
    mockedQuery.mockResolvedValue([asset('a')]);

    await act(() => result.current.requestAccess());

    await waitFor(() => expect(result.current.status).toBe('granted'));
    expect(result.current.items).toHaveLength(1);
  });
});
