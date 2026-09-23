import { render, screen, userEvent } from '@testing-library/react-native';

import { MediaGridItem } from '.';

import { MediaLimits } from '@/features/media/constants';
import type { MediaLibraryItem } from '@/features/media/mediaLibrary';
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
});

describe('MediaGridItem', () => {
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
