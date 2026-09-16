import { useVideoPlayer } from 'expo-video';
import { fireEvent, render } from '@testing-library/react-native';

import { VideoNotePlayer } from '.';

jest.mock('expo-video', () => {
  const { View } = require('react-native');

  return {
    useVideoPlayer: jest.fn(),
    VideoView: (props: object) => <View {...props} />,
  };
});

const player = { play: jest.fn(), pause: jest.fn(), loop: false };

beforeEach(() => {
  jest.clearAllMocks();
  player.loop = false;
  (useVideoPlayer as jest.Mock).mockImplementation((_uri, setup?: (p: object) => void) => {
    setup?.(player);
    return player;
  });
});

describe('VideoNotePlayer', () => {
  it('loops, the way a video message is read', async () => {
    await render(<VideoNotePlayer uri="https://cdn.test/note.mp4" durationMs={8000} />);

    expect(player.loop).toBe(true);
  });

  it('shows the stored duration while stopped', async () => {
    const { getByText } = await render(
      <VideoNotePlayer uri="https://cdn.test/note.mp4" durationMs={8000} />,
    );

    expect(getByText('0:08')).toBeTruthy();
  });

  it('plays on tap and hides the duration while playing', async () => {
    const { getByLabelText, queryByText } = await render(
      <VideoNotePlayer uri="https://cdn.test/note.mp4" durationMs={8000} />,
    );

    await fireEvent.press(getByLabelText('Play video message'));

    expect(player.play).toHaveBeenCalled();
    expect(queryByText('0:08')).toBeNull();
  });

  it('pauses on a second tap', async () => {
    const { getByLabelText } = await render(
      <VideoNotePlayer uri="https://cdn.test/note.mp4" durationMs={8000} />,
    );

    await fireEvent.press(getByLabelText('Play video message'));
    await fireEvent.press(getByLabelText('Pause video message'));

    expect(player.pause).toHaveBeenCalled();
  });

  it('is a circle of the requested size', async () => {
    const { getByLabelText } = await render(
      <VideoNotePlayer uri="https://cdn.test/note.mp4" durationMs={8000} size={180} />,
    );

    expect(getByLabelText('Play video message')).toHaveStyle({ width: 180, height: 180 });
  });
});
