import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useVideoPlayer } from 'expo-video';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { MediaViewer } from '.';

import type { TileRegistry } from '@/features/media/tileRegistry';

jest.mock('expo-video', () => {
  const { View } = require('react-native');

  return {
    useVideoPlayer: jest.fn(),
    VideoView: (props: object) => <View {...props} />,
  };
});

const player = { play: jest.fn(), pause: jest.fn(), loop: false, playing: true };

const items = [
  { id: 'p1', kind: 'photo' as const, url: 'https://cdn.test/a.jpg', width: 800, height: 600 },
  { id: 'v1', kind: 'video' as const, url: 'https://cdn.test/b.mp4', width: null, height: null },
];

const tile = { x: 10, y: 400, width: 120, height: 90 };

function tilesAt(rect: typeof tile | null): TileRegistry {
  return {
    register: jest.fn(),
    unregister: jest.fn(),
    measure: jest.fn(() => Promise.resolve(rect)),
  };
}

/** Окно на экране: с этого момента медиа летит из плитки. */
async function showWindow() {
  await act(async () => {
    fireEvent(screen.getByTestId('media-viewer-window'), 'show');
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  player.playing = true;
  // Как у настоящего плеера: настройка — один раз на плеер, а не на каждую отрисовку.
  (useVideoPlayer as jest.Mock).mockImplementation((_uri, setup?: (p: object) => void) => {
    const { useState } = require('react');
    const [ready] = useState(() => {
      setup?.(player);
      return player;
    });

    return ready;
  });
});

describe('MediaViewer', () => {
  it('closes with the ✕ button', async () => {
    const onClose = jest.fn();

    await render(<MediaViewer visible items={items} initialIndex={0} onClose={onClose} />);
    await showWindow();
    await fireEvent.press(screen.getByLabelText('Закрыть просмотр'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('flies back into the tile of the file it was closed on', async () => {
    const tiles = tilesAt(tile);
    const onClose = jest.fn();

    await render(
      <MediaViewer
        visible
        items={items}
        initialIndex={0}
        origin={tile}
        tiles={tiles}
        onClose={onClose}
      />,
    );
    await showWindow();
    await fireEvent.press(screen.getByLabelText('Закрыть просмотр'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(tiles.measure).toHaveBeenCalledWith('p1');
  });

  it('still closes when the tile is gone from the screen', async () => {
    const onClose = jest.fn();

    await render(
      <MediaViewer
        visible
        items={items}
        initialIndex={0}
        origin={tile}
        tiles={tilesAt(null)}
        onClose={onClose}
      />,
    );
    await showWindow();
    await fireEvent.press(screen.getByLabelText('Закрыть просмотр'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('waits for the finger to lift before it opens', async () => {
    const view = await render(
      <MediaViewer visible armed items={items} initialIndex={1} onClose={jest.fn()} />,
    );
    await showWindow();

    expect(player.play).not.toHaveBeenCalled();

    await view.rerender(
      <MediaViewer visible armed={false} items={items} initialIndex={1} onClose={jest.fn()} />,
    );

    await waitFor(() => expect(player.play).toHaveBeenCalled());
  });

  it('plays the video only once it has landed', async () => {
    await render(<MediaViewer visible items={items} initialIndex={1} onClose={jest.fn()} />);

    expect(player.play).not.toHaveBeenCalled();

    await showWindow();

    await waitFor(() => expect(player.play).toHaveBeenCalled());
    expect(player.pause).not.toHaveBeenCalled();
  });

  it('pauses the video by a single tap, and a screen reader can do the same', async () => {
    await render(<MediaViewer visible items={items} initialIndex={1} onClose={jest.fn()} />);
    await showWindow();
    await waitFor(() => expect(player.play).toHaveBeenCalled());

    await act(async () => {
      fireGestureHandler(getByGestureTestId('media-viewer-tap'), [
        { state: State.BEGAN },
        { state: State.ACTIVE },
        { state: State.END },
      ]);
    });

    expect(player.pause).toHaveBeenCalledTimes(1);

    player.playing = false;
    await fireEvent(screen.getByLabelText('Воспроизвести видео'), 'accessibilityTap');

    expect(player.play).toHaveBeenCalledTimes(2);
  });

  it('renders nothing while hidden', async () => {
    await render(<MediaViewer visible={false} items={items} initialIndex={0} onClose={jest.fn()} />);

    expect(screen.queryByTestId('media-viewer')).toBeNull();
  });
});
