import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { fireEvent, render } from '@testing-library/react-native';

import { VoicePlayer } from '.';

jest.mock('expo-audio', () => ({
  useAudioPlayer: jest.fn(),
  useAudioPlayerStatus: jest.fn(),
}));

const player = { play: jest.fn(), pause: jest.fn(), seekTo: jest.fn() };

function setStatus(status: {
  playing?: boolean;
  currentTime?: number;
  duration?: number;
  isLoaded?: boolean;
  didJustFinish?: boolean;
}) {
  (useAudioPlayerStatus as jest.Mock).mockReturnValue({
    playing: status.playing ?? false,
    currentTime: status.currentTime ?? 0,
    duration: status.duration ?? 0,
    isLoaded: status.isLoaded ?? true,
    didJustFinish: status.didJustFinish ?? false,
    isBuffering: false,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (useAudioPlayer as jest.Mock).mockReturnValue(player);
  setStatus({});
});

describe('VoicePlayer', () => {
  it('shows the stored duration before the file has loaded', async () => {
    setStatus({ isLoaded: false });
    const { getByText } = await render(
      <VoicePlayer uri="https://cdn.test/voice.m4a" durationMs={95_000} />,
    );

    expect(getByText('1:35')).toBeTruthy();
  });

  it('starts playback when the button is pressed', async () => {
    const { getByLabelText } = await render(
      <VoicePlayer uri="https://cdn.test/voice.m4a" durationMs={10_000} />,
    );

    await fireEvent.press(getByLabelText('Play voice message'));

    expect(player.play).toHaveBeenCalled();
  });

  it('pauses while playing', async () => {
    setStatus({ playing: true, duration: 10, currentTime: 3 });
    const { getByLabelText } = await render(
      <VoicePlayer uri="https://cdn.test/voice.m4a" durationMs={10_000} />,
    );

    await fireEvent.press(getByLabelText('Pause voice message'));

    expect(player.pause).toHaveBeenCalled();
    expect(player.play).not.toHaveBeenCalled();
  });

  it('rewinds before replaying a finished message', async () => {
    setStatus({ duration: 10, currentTime: 10, didJustFinish: true });
    const { getByLabelText } = await render(
      <VoicePlayer uri="https://cdn.test/voice.m4a" durationMs={10_000} />,
    );

    await fireEvent.press(getByLabelText('Play voice message'));

    expect(player.seekTo).toHaveBeenCalledWith(0);
    expect(player.play).toHaveBeenCalled();
  });

  it('shows elapsed time and progress while playing', async () => {
    setStatus({ playing: true, duration: 10, currentTime: 5 });
    const { getByText, getByTestId } = await render(
      <VoicePlayer uri="https://cdn.test/voice.m4a" durationMs={10_000} />,
    );

    expect(getByText('0:05')).toBeTruthy();
    expect(getByTestId('voice-player-progress')).toHaveStyle({ width: '50%' });
  });
});
