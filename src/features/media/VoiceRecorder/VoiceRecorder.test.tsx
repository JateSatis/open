import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { VoiceRecorder } from '.';

import { MediaLimits } from '@/features/media/constants';
import { useVoiceRecorder } from '@/features/media/useVoiceRecorder';

jest.mock('@/features/media/useVoiceRecorder', () => ({ useVoiceRecorder: jest.fn() }));

const recording = {
  kind: 'voice' as const,
  uri: 'file:///cache/voice.m4a',
  mimeType: 'audio/mp4',
  width: null,
  height: null,
  durationMs: 4200,
};

const start = jest.fn();
const stop = jest.fn();
const cancel = jest.fn();

function mockRecorder(overrides: { status?: string; durationMs?: number; level?: number } = {}) {
  (useVoiceRecorder as jest.Mock).mockReturnValue({
    status: overrides.status ?? 'idle',
    durationMs: overrides.durationMs ?? 0,
    level: overrides.level ?? null,
    start,
    stop,
    cancel,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  stop.mockResolvedValue(recording);
  cancel.mockResolvedValue(undefined);
  mockRecorder();
});

describe('VoiceRecorder', () => {
  it('starts recording when the record button is pressed', async () => {
    const { getByLabelText } = await render(<VoiceRecorder onRecorded={jest.fn()} />);

    await fireEvent.press(getByLabelText('Record voice message'));

    expect(start).toHaveBeenCalled();
  });

  it('shows the elapsed time while recording', async () => {
    mockRecorder({ status: 'recording', durationMs: 4200 });
    const { getByText } = await render(<VoiceRecorder onRecorded={jest.fn()} />);

    expect(getByText('0:04')).toBeTruthy();
  });

  it('hands the finished recording to the caller', async () => {
    mockRecorder({ status: 'recording', durationMs: 4200 });
    const onRecorded = jest.fn();
    const { getByText } = await render(<VoiceRecorder onRecorded={onRecorded} />);

    await fireEvent.press(getByText('Send'));

    await waitFor(() => expect(onRecorded).toHaveBeenCalledWith(recording));
  });

  it('discards the recording on cancel without sending it', async () => {
    mockRecorder({ status: 'recording', durationMs: 4200 });
    const onRecorded = jest.fn();
    const onCancel = jest.fn();
    const { getByText } = await render(
      <VoiceRecorder onRecorded={onRecorded} onCancel={onCancel} />,
    );

    await fireEvent.press(getByText('Cancel'));

    await waitFor(() => expect(onCancel).toHaveBeenCalled());
    expect(cancel).toHaveBeenCalled();
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it('cancels instead of sending when the recording was too short to keep', async () => {
    mockRecorder({ status: 'recording', durationMs: 200 });
    stop.mockResolvedValue(null);
    const onRecorded = jest.fn();
    const onCancel = jest.fn();
    const { getByText } = await render(
      <VoiceRecorder onRecorded={onRecorded} onCancel={onCancel} />,
    );

    await fireEvent.press(getByText('Send'));

    await waitFor(() => expect(onCancel).toHaveBeenCalled());
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it('sends automatically once the maximum length is reached', async () => {
    mockRecorder({ status: 'recording', durationMs: MediaLimits.voice.maxDurationMs });
    const onRecorded = jest.fn();
    await render(<VoiceRecorder onRecorded={onRecorded} />);

    await waitFor(() => expect(onRecorded).toHaveBeenCalledWith(recording));
  });

  it('explains a refused microphone instead of offering a dead button', async () => {
    mockRecorder({ status: 'denied' });
    const { getByText, queryByLabelText } = await render(<VoiceRecorder onRecorded={jest.fn()} />);

    expect(getByText(/Microphone access is off/)).toBeTruthy();
    expect(queryByLabelText('Record voice message')).toBeNull();
  });
});
