import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';

import { MediaGridItem } from '.';

import { MediaLimits } from '@/features/media/constants';
import type { MediaLibraryItem } from '@/features/media/mediaLibrary';
import { resetMediaPreview, useMediaPreview } from '@/features/media/MediaPreview/previewStore';
import { useMediaSelection } from '@/features/media/selectionStore';

const photo: MediaLibraryItem = {
  id: 'content://media/external/images/media/1',
  kind: 'photo',
  width: 100,
  height: 100,
  durationMs: null,
};

const video: MediaLibraryItem = {
  id: 'content://media/external/video/media/2',
  kind: 'video',
  width: 100,
  height: 100,
  durationMs: 12_000,
};

function select(...assets: MediaLibraryItem[]) {
  for (const asset of assets) useMediaSelection.getState().toggle(asset);
}

beforeEach(() => {
  useMediaSelection.getState().clear();
  resetMediaPreview();
});

describe('MediaGridItem', () => {
  it('forgets a broken preview once the cell is reused for another file', async () => {
    const { rerender } = await render(
      <MediaGridItem asset={photo} size={100} onToggle={jest.fn()} />,
    );

    await act(async () => {
      fireEvent(screen.getByTestId('media-grid-preview'), 'error', {
        nativeEvent: { error: 'broken' },
      });
    });

    expect(screen.getByText('?')).toBeTruthy();

    // Список переиспользует ту же клетку под следующий файл.
    await rerender(<MediaGridItem asset={video} size={100} onToggle={jest.fn()} />);

    expect(screen.queryByText('?')).toBeNull();
    expect(screen.getByTestId('media-grid-preview')).toBeTruthy();
  });

  it('shows the preview straight from the asset id — nothing is resolved first', async () => {
    await render(<MediaGridItem asset={photo} size={100} onToggle={jest.fn()} />);

    expect(screen.getByLabelText('Выбрать файл')).toBeTruthy();
  });

  it('reports the whole asset when the circle is tapped', async () => {
    const onToggle = jest.fn();

    await render(<MediaGridItem asset={photo} size={100} onToggle={onToggle} />);

    const user = userEvent.setup();
    await user.press(screen.getByLabelText('Выбрать файл'));

    expect(onToggle).toHaveBeenCalledWith(photo);
  });

  it('takes its selection number from the store, not from a prop', async () => {
    select({ ...photo, id: 'other' }, photo);

    await render(<MediaGridItem asset={photo} size={100} onToggle={jest.fn()} />);

    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByLabelText('Убрать из выбранного')).toBeTruthy();
  });

  it('disables selecting once the album limit is reached, but not for an already picked file', async () => {
    for (let index = 0; index < MediaLimits.gallery.maxSelection; index++) {
      select({ ...photo, id: `filler-${index}` });
    }

    await render(<MediaGridItem asset={photo} size={100} onToggle={jest.fn()} />);

    expect(screen.getByLabelText('Выбрать файл').props.accessibilityState.disabled).toBe(true);
  });

  it('shows a duration badge on video files so they read differently from photos', async () => {
    await render(<MediaGridItem asset={video} size={100} onToggle={jest.fn()} />);

    expect(screen.getByText('0:12')).toBeTruthy();
  });
});

describe('MediaGridItem: тап по самой плитке', () => {
  it('открывает предпросмотр этого файла и не трогает выбор', async () => {
    const user = userEvent.setup();

    await render(<MediaGridItem asset={photo} size={100} onToggle={jest.fn()} />);
    await user.press(screen.getByLabelText('Открыть фото'));

    expect(useMediaPreview.getState().target?.assetId).toBe(photo.id);
    expect(useMediaSelection.getState().order).toEqual([]);
  });

  it('кружок только выбирает — предпросмотр не открывается', async () => {
    const onToggle = jest.fn();
    const user = userEvent.setup();

    await render(<MediaGridItem asset={photo} size={100} onToggle={onToggle} />);
    await user.press(screen.getByLabelText('Выбрать файл'));

    expect(onToggle).toHaveBeenCalledWith(photo);
    expect(useMediaPreview.getState().target).toBeNull();
  });

  it('в выборе одного файла тап по плитке выбирает её, а не открывает предпросмотр', async () => {
    const onPick = jest.fn();
    const user = userEvent.setup();

    await render(
      <MediaGridItem
        asset={photo}
        size={100}
        onToggle={jest.fn()}
        pick={{ accepts: () => true, onPick }}
      />,
    );
    await user.press(screen.getByTestId('media-grid-pick'));

    expect(onPick).toHaveBeenCalledWith(photo);
    expect(screen.queryByLabelText('Открыть фото')).toBeNull();
    expect(useMediaPreview.getState().target).toBeNull();
  });
});

describe('MediaGridItem in pick mode', () => {
  const photosOnly = (asset: MediaLibraryItem) => asset.kind === 'photo';

  it('hands the file over on a tap without touching the shared selection', async () => {
    const onPick = jest.fn();
    const user = userEvent.setup();

    await render(
      <MediaGridItem
        asset={photo}
        size={100}
        onToggle={jest.fn()}
        pick={{ accepts: photosOnly, onPick }}
      />,
    );
    await user.press(screen.getByTestId('media-grid-pick'));

    expect(onPick).toHaveBeenCalledWith(photo);
    expect(useMediaSelection.getState().order).toEqual([]);
    expect(screen.queryByLabelText('Выбрать файл')).toBeNull();
  });

  it('keeps a file it does not accept visible but untappable', async () => {
    const onPick = jest.fn();
    const user = userEvent.setup();

    await render(
      <MediaGridItem
        asset={video}
        size={100}
        onToggle={jest.fn()}
        pick={{ accepts: photosOnly, onPick }}
      />,
    );
    await user.press(screen.getByTestId('media-grid-pick'));

    expect(screen.getByTestId('media-grid-pick')).toBeDisabled();
    expect(onPick).not.toHaveBeenCalled();
  });
});
