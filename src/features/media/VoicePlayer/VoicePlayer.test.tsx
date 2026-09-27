import { fireEvent, render } from '@testing-library/react-native';

import { VoicePlayer, voiceDurationLabel } from '.';

import { seekVoice, toggleVoice, useVoicePlayback } from '@/features/media/voicePlayback';

jest.mock('@/features/media/voicePlayback', () => ({
  toggleVoice: jest.fn(),
  seekVoice: jest.fn(),
  useVoicePlayback: jest.fn(),
}));

function setPlayback(state: Partial<ReturnType<typeof useVoicePlayback>>) {
  (useVoicePlayback as jest.Mock).mockReturnValue({
    isActive: false,
    playing: false,
    loading: false,
    failed: false,
    positionMs: 0,
    durationMs: 0,
    ...state,
  });
}

const WAVEFORM = Array.from({ length: 50 }, (_, index) => index % 32);

function renderPlayer() {
  return render(
    <VoicePlayer
      playbackKey="voice-1"
      uri="https://cdn.test/voice.m4a"
      durationMs={95_000}
      waveform={WAVEFORM}
      buttonColor="#00f"
      buttonIconColor="#fff"
      playedColor="#00f"
      restColor="#ccc"
      timeColor="textSecondary"
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  setPlayback({});
});

describe('VoicePlayer', () => {
  it('shows the stored duration before anything is loaded', async () => {
    const { getByText } = await renderPlayer();

    expect(getByText('1:35')).toBeTruthy();
  });

  it('starts this message in the shared player', async () => {
    const { getByLabelText } = await renderPlayer();

    await fireEvent.press(getByLabelText('Слушать голосовое сообщение'));

    expect(toggleVoice).toHaveBeenCalledWith({
      key: 'voice-1',
      uri: 'https://cdn.test/voice.m4a',
      durationMs: 95_000,
    });
  });

  it('offers a pause while playing and shows the elapsed time', async () => {
    setPlayback({ isActive: true, playing: true, positionMs: 5_000, durationMs: 10_000 });
    const { getByLabelText, getByText } = await renderPlayer();

    expect(getByLabelText('Пауза')).toBeTruthy();
    expect(getByText('0:05')).toBeTruthy();
  });

  it('fills the waveform as far as it has played', async () => {
    setPlayback({ isActive: true, playing: true, positionMs: 5_000, durationMs: 10_000 });
    const { getAllByTestId } = await renderPlayer();

    expect(getAllByTestId('waveform-bar-played')).toHaveLength(25);
    expect(getAllByTestId('waveform-bar')).toHaveLength(25);
  });

  it('draws a flat track instead of inventing a waveform', async () => {
    const { getAllByTestId } = await render(
      <VoicePlayer
        playbackKey="voice-2"
        uri="https://cdn.test/voice.m4a"
        durationMs={4_000}
        waveform={null}
        buttonColor="#00f"
        buttonIconColor="#fff"
        playedColor="#00f"
        restColor="#ccc"
        timeColor="textSecondary"
      />,
    );

    const heights = getAllByTestId('waveform-bar').map(
      (bar) => (bar.props.style as { height: number }[])[1].height,
    );

    expect(new Set(heights).size).toBe(1);
  });

  it('seeks through the accessibility action on the waveform', async () => {
    setPlayback({ isActive: true, playing: true, positionMs: 5_000, durationMs: 10_000 });
    const { getByLabelText } = await renderPlayer();

    await fireEvent(getByLabelText('Перемотка голосового сообщения'), 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });

    expect(seekVoice).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'voice-1' }),
      expect.closeTo(0.6),
    );
  });

  it('says so when the file could not be loaded', async () => {
    setPlayback({ failed: true });
    const { getByText } = await renderPlayer();

    expect(getByText('Не удалось загрузить')).toBeTruthy();
  });

  it('never shows a sent voice message as 0:00', () => {
    expect(voiceDurationLabel(800)).toBe('0:01');
    expect(voiceDurationLabel(12_400)).toBe('0:12');
  });
});
