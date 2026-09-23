import { render, screen, userEvent } from '@testing-library/react-native';
import type { FlatListProps } from 'react-native';

import { MediaGrid } from '.';

import { useMediaSelection } from '@/features/media/selectionStore';
import type { MediaLibraryItem } from '@/features/media/mediaLibrary';
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

  it('lays rows out by row index, not by file index', async () => {
    // FlatList отдаёт getItemLayout в VirtualizedList как есть, а тот при
    // numColumns считает строками: его getItemCount возвращает
    // ceil(файлов / колонок). Если поделить index на число колонок ещё раз,
    // список решит, что его содержимое втрое короче, и в глубине галереи
    // начнёт рисовать пустоту вместо клеток.
    gallery([asset('a'), asset('b'), asset('c'), asset('d')]);

    let captured: FlatListProps<MediaLibraryItem>['getItemLayout'];
    const Capture = (props: { getItemLayout?: typeof captured }) => {
      captured = props.getItemLayout;
      return null;
    };

    await render(<MediaGrid ListComponent={Capture} headerHeight={100} />);

    const rowZero = captured?.(null, 0);
    const rowOne = captured?.(null, 1);
    const rowTwo = captured?.(null, 2);

    expect(rowZero?.offset).toBe(100);
    // Соседние строки стоят ровно на высоту строки друг под другом.
    expect((rowOne?.offset ?? 0) - (rowZero?.offset ?? 0)).toBeCloseTo(rowZero?.length ?? 0, 5);
    expect((rowTwo?.offset ?? 0) - (rowOne?.offset ?? 0)).toBeCloseTo(rowOne?.length ?? 0, 5);
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
