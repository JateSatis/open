import { renderHook, waitFor } from '@testing-library/react-native';

import { useAssetUri } from './useAssetUri';
import { resolveAssetUri } from './mediaLibrary';

jest.mock('./mediaLibrary', () => ({
  resolveAssetUri: jest.fn(),
}));

const mockedResolve = resolveAssetUri as jest.MockedFunction<typeof resolveAssetUri>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useAssetUri', () => {
  it('starts null and resolves once the native call answers', async () => {
    mockedResolve.mockResolvedValue('file:///cache/a1.jpg');

    const { result } = await renderHook(() => useAssetUri('a1'));

    await waitFor(() => expect(result.current).toBe('file:///cache/a1.jpg'));
  });

  it('reuses a cached uri instantly instead of resolving again', async () => {
    mockedResolve.mockResolvedValue('file:///cache/a1.jpg');

    const first = await renderHook(() => useAssetUri('a1'));
    await waitFor(() => expect(first.result.current).toBe('file:///cache/a1.jpg'));

    mockedResolve.mockClear();

    const second = await renderHook(() => useAssetUri('a1'));

    expect(second.result.current).toBe('file:///cache/a1.jpg');
    expect(mockedResolve).not.toHaveBeenCalled();
  });

  it('stays null when the asset can no longer be resolved', async () => {
    mockedResolve.mockRejectedValue(new Error('not found'));

    const { result } = await renderHook(() => useAssetUri('gone'));

    await waitFor(() => expect(mockedResolve).toHaveBeenCalled());

    expect(result.current).toBeNull();
  });
});
