import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useVideoPlayer } from 'expo-video';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { MediaViewer } from '.';

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

beforeEach(() => {
  jest.clearAllMocks();
  player.playing = true;
  (useVideoPlayer as jest.Mock).mockImplementation((_uri, setup?: (p: object) => void) => {
    setup?.(player);
    return player;
  });
});

describe('MediaViewer', () => {
  it('closes with the ✕ button', async () => {
    const onClose = jest.fn();

    await render(<MediaViewer visible items={items} initialIndex={0} onClose={onClose} />);
    await fireEvent.press(screen.getByLabelText('Закрыть просмотр'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('plays only the page that is open', async () => {
    await render(<MediaViewer visible items={items} initialIndex={1} onClose={jest.fn()} />);

    expect(player.play).toHaveBeenCalled();
    expect(player.pause).not.toHaveBeenCalled();
  });

  it('pauses the video by a single tap, and a screen reader can do the same', async () => {
    await render(<MediaViewer visible items={items} initialIndex={1} onClose={jest.fn()} />);

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
