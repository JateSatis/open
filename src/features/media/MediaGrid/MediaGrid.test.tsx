import { render, screen, userEvent } from '@testing-library/react-native';

import { MediaGrid } from '.';
import { cachedAssetUri } from '@/features/media/assetUriCache';
import { useRecentMedia } from '@/features/media/useRecentMedia';

jest.mock('@/features/media/useRecentMedia', () => ({
  useRecentMedia: jest.fn(),
}));
jest.mock('@/features/media/useVideoThumbnail', () => ({
  useVideoThumbnail: jest.fn(() => null),
}));
jest.mock('@/features/media/useAssetUri', () => ({
  useAssetUri: jest.fn((id: string) => `file:///${id}.jpg`),
}));
jest.mock('@/features/media/assetUriCache', () => ({
  cachedAssetUri: jest.fn(() => null),
}));

const mockedUseRecentMedia = useRecentMedia as jest.MockedFunction<typeof useRecentMedia>;
const mockedCachedAssetUri = cachedAssetUri as jest.MockedFunction<typeof cachedAssetUri>;

function asset(id: string) {
  return { id, kind: 'photo' as const, width: 10, height: 10, durationMs: null };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('MediaGrid', () => {
  it('offers to ask for access again instead of showing an empty grid', async () => {
    const requestAccess = jest.fn();
    mockedUseRecentMedia.mockReturnValue({
      status: 'denied',
      items: [],
      isLoadingMore: false,
      hasMore: false,
      loadMore: jest.fn(),
      requestAccess,
    });

    await render(<MediaGrid selected={[]} onToggle={jest.fn()} />);

    expect(screen.getByText(/без доступа к галерее/)).toBeTruthy();

    const user = userEvent.setup();
    await user.press(screen.getByText('Разрешить доступ'));

    expect(requestAccess).toHaveBeenCalledTimes(1);
  });

  it('renders every recent file as a grid cell', async () => {
    mockedUseRecentMedia.mockReturnValue({
      status: 'granted',
      items: [asset('a'), asset('b')],
      isLoadingMore: false,
      hasMore: false,
      loadMore: jest.fn(),
      requestAccess: jest.fn(),
    });

    await render(<MediaGrid selected={[]} onToggle={jest.fn()} />);

    expect(screen.getAllByLabelText('Выбрать файл')).toHaveLength(2);
  });

  it('passes the tapped asset back with the path it already has cached', async () => {
    const onToggle = jest.fn();
    mockedCachedAssetUri.mockReturnValue('file:///a.jpg');
    mockedUseRecentMedia.mockReturnValue({
      status: 'granted',
      items: [asset('a')],
      isLoadingMore: false,
      hasMore: false,
      loadMore: jest.fn(),
      requestAccess: jest.fn(),
    });

    await render(<MediaGrid selected={[]} onToggle={onToggle} />);

    const user = userEvent.setup();
    await user.press(screen.getByLabelText('Выбрать файл'));

    expect(onToggle).toHaveBeenCalledWith({ ...asset('a'), uri: 'file:///a.jpg' });
  });

  it('selects a file whose path has not been resolved yet — the tap does not wait for it', async () => {
    const onToggle = jest.fn();
    mockedCachedAssetUri.mockReturnValue(null);
    mockedUseRecentMedia.mockReturnValue({
      status: 'granted',
      items: [asset('a')],
      isLoadingMore: false,
      hasMore: false,
      loadMore: jest.fn(),
      requestAccess: jest.fn(),
    });

    await render(<MediaGrid selected={[]} onToggle={onToggle} />);

    const user = userEvent.setup();
    await user.press(screen.getByLabelText('Выбрать файл'));

    expect(onToggle).toHaveBeenCalledWith({ ...asset('a'), uri: null });
  });
});
