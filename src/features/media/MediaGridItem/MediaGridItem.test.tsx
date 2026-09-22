import { render, screen, userEvent } from '@testing-library/react-native';

import { MediaGridItem } from '.';

import type { LibraryAsset } from '@/features/media/mediaLibrary';

jest.mock('@/features/media/useVideoThumbnail', () => ({
  useVideoThumbnail: jest.fn(() => null),
}));

const photo: LibraryAsset = {
  id: 'a1',
  kind: 'photo',
  uri: 'file:///cache/a1.jpg',
  width: 100,
  height: 100,
  durationMs: null,
};

const video: LibraryAsset = {
  id: 'v1',
  kind: 'video',
  uri: 'file:///cache/v1.mp4',
  width: 100,
  height: 100,
  durationMs: 12_000,
};

describe('MediaGridItem', () => {
  it('shows the selection order once a file is picked', async () => {
    const onToggle = jest.fn();

    await render(
      <MediaGridItem asset={photo} size={100} selectionOrder={2} disabled={false} onToggle={onToggle} />,
    );

    expect(screen.getByText('2')).toBeTruthy();

    const user = userEvent.setup();
    await user.press(screen.getByLabelText('Убрать из выбранного'));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('offers a select button for an unpicked file', async () => {
    const onToggle = jest.fn();

    await render(
      <MediaGridItem asset={photo} size={100} selectionOrder={null} disabled={false} onToggle={onToggle} />,
    );

    const user = userEvent.setup();
    await user.press(screen.getByLabelText('Выбрать файл'));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('disables selecting once the album limit is reached, but not for an already picked file', async () => {
    await render(
      <MediaGridItem asset={photo} size={100} selectionOrder={null} disabled onToggle={jest.fn()} />,
    );

    expect(screen.getByLabelText('Выбрать файл').props.accessibilityState.disabled).toBe(true);
  });

  it('shows a duration badge on video files so they read differently from photos', async () => {
    await render(
      <MediaGridItem asset={video} size={100} selectionOrder={null} disabled={false} onToggle={jest.fn()} />,
    );

    expect(screen.getByText('0:12')).toBeTruthy();
  });
});
