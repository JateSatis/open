import { render, screen, userEvent } from '@testing-library/react-native';

import { MediaGrid } from '.';
import { useRecentMedia } from '@/features/media/useRecentMedia';

jest.mock('@/features/media/useRecentMedia', () => ({
  useRecentMedia: jest.fn(),
}));
jest.mock('@/features/media/useVideoThumbnail', () => ({
  useVideoThumbnail: jest.fn(() => null),
}));

const mockedUseRecentMedia = useRecentMedia as jest.MockedFunction<typeof useRecentMedia>;

function asset(id: string) {
  return { id, kind: 'photo' as const, uri: `file:///${id}.jpg`, width: 10, height: 10, durationMs: null };
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

  it('passes the tapped asset back to the caller', async () => {
    const onToggle = jest.fn();
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

    expect(onToggle).toHaveBeenCalledWith(asset('a'));
  });
});
