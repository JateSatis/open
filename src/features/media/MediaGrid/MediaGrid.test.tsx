import { render, screen, userEvent } from '@testing-library/react-native';

import { MediaGrid } from '.';

import { useMediaSelection } from '@/features/media/selectionStore';
import { useGalleryAssets, type GalleryStatus } from '@/features/media/useGalleryAssets';

jest.mock('@/features/media/useGalleryAssets', () => ({
  useGalleryAssets: jest.fn(),
}));

const mockedUseGalleryAssets = useGalleryAssets as jest.MockedFunction<typeof useGalleryAssets>;

function asset(id: string) {
  return { id, kind: 'photo' as const, width: 10, height: 10, durationMs: null };
}

function gallery(
  items: ReturnType<typeof asset>[],
  status: GalleryStatus = 'ready',
  total: number | null = items.length,
) {
  mockedUseGalleryAssets.mockReturnValue({
    status,
    items,
    total,
    isFilling: false,
    requestAccess: jest.fn(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  useMediaSelection.getState().clear();
});

describe('MediaGrid', () => {
  it('offers to ask for access again instead of showing an empty grid', async () => {
    const requestAccess = jest.fn();
    mockedUseGalleryAssets.mockReturnValue({
      status: 'denied',
      items: [],
      total: null,
      isFilling: false,
      requestAccess,
    });

    await render(<MediaGrid />);

    expect(screen.getByText(/без доступа к галерее/)).toBeTruthy();

    const user = userEvent.setup();
    await user.press(screen.getByText('Разрешить доступ'));

    expect(requestAccess).toHaveBeenCalledTimes(1);
  });

  it('renders every file of the gallery as a grid cell', async () => {
    gallery([asset('a'), asset('b')]);

    await render(<MediaGrid />);

    expect(screen.getAllByLabelText('Выбрать файл')).toHaveLength(2);
  });

  it('keeps the media library untouched until it is enabled', async () => {
    gallery([]);

    await render(<MediaGrid enabled={false} />);

    expect(mockedUseGalleryAssets).toHaveBeenCalledWith(false);
  });

  it('shows a skeleton and stays silent about an empty gallery while it is still being read', async () => {
    // Разрешение выдано, медиатека ещё отвечает. Сказать в этот момент, что
    // фотографий нет, — соврать: их просто ещё не прочитали.
    gallery([], 'loading', null);

    await render(<MediaGrid />);

    expect(screen.queryByText(/нет фото и видео/)).toBeNull();
    expect(screen.getAllByTestId('media-grid-skeleton').length).toBeGreaterThan(0);
  });

  it('keeps the skeleton going up to the known length of the gallery', async () => {
    // Первый кусок уже приехал, вся галерея — нет. Место под непрочитанные
    // файлы занято заранее, иначе на быстром скролле список просто кончится.
    gallery([asset('a')], 'ready', 40);

    await render(<MediaGrid />);

    expect(screen.getAllByLabelText('Выбрать файл')).toHaveLength(1);
    expect(screen.getAllByTestId('media-grid-skeleton').length).toBeGreaterThan(0);
  });

  it('says the gallery is empty only once it has been read', async () => {
    gallery([], 'empty', 0);

    await render(<MediaGrid />);

    expect(screen.getByText(/нет фото и видео/)).toBeTruthy();
    expect(screen.queryByTestId('media-grid-skeleton')).toBeNull();
  });

  it('writes the tapped file into the selection store, in tap order', async () => {
    gallery([asset('a'), asset('b')]);

    await render(<MediaGrid />);

    const user = userEvent.setup();
    const circles = screen.getAllByLabelText('Выбрать файл');
    await user.press(circles[1]);
    await user.press(circles[0]);

    expect(useMediaSelection.getState().order).toEqual(['b', 'a']);
  });
});
