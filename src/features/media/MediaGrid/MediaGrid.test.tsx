import { render, screen, userEvent } from '@testing-library/react-native';

import { MediaGrid } from '.';

import { useMediaSelection } from '@/features/media/selectionStore';
import { useGalleryAssets } from '@/features/media/useGalleryAssets';

jest.mock('@/features/media/useGalleryAssets', () => ({
  useGalleryAssets: jest.fn(),
}));

const mockedUseGalleryAssets = useGalleryAssets as jest.MockedFunction<typeof useGalleryAssets>;

function asset(id: string) {
  return { id, kind: 'photo' as const, width: 10, height: 10, durationMs: null };
}

function gallery(items: ReturnType<typeof asset>[], status: 'granted' | 'denied' = 'granted') {
  mockedUseGalleryAssets.mockReturnValue({
    status,
    items,
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
