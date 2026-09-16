import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { act, renderHook } from '@testing-library/react-native';

import { MediaLimits } from './constants';
import { useVoiceRecorder } from './useVoiceRecorder';

jest.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: { extension: '.m4a', sampleRate: 44100 } },
  requestRecordingPermissionsAsync: jest.fn(),
  setAudioModeAsync: jest.fn(),
  useAudioRecorder: jest.fn(),
  useAudioRecorderState: jest.fn(),
}));

jest.mock('expo-file-system', () => ({ File: jest.fn() }));

const deleteFile = jest.fn();
const recorder = {
  uri: 'file:///cache/voice.m4a',
  isRecording: false,
  record: jest.fn(),
  stop: jest.fn().mockResolvedValue(undefined),
  prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
};

function setRecorderState(state: {
  isRecording?: boolean;
  durationMillis?: number;
  metering?: number;
}) {
  (useAudioRecorderState as jest.Mock).mockReturnValue({
    canRecord: true,
    isRecording: state.isRecording ?? false,
    durationMillis: state.durationMillis ?? 0,
    mediaServicesDidReset: false,
    metering: state.metering,
    url: null,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  recorder.uri = 'file:///cache/voice.m4a';
  recorder.isRecording = false;
  (useAudioRecorder as jest.Mock).mockReturnValue(recorder);
  (requestRecordingPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (setAudioModeAsync as jest.Mock).mockResolvedValue(undefined);
  (File as unknown as jest.Mock).mockImplementation(() => ({ delete: deleteFile }));
  setRecorderState({});
});

describe('useVoiceRecorder', () => {
  it('starts recording once the microphone is granted', async () => {
    const { result } = await renderHook(() => useVoiceRecorder());

    await act(async () => {
      await result.current.start();
    });

    expect(recorder.record).toHaveBeenCalled();
    expect(result.current.status).toBe('recording');
  });

  it('reports a denied microphone instead of recording', async () => {
    (requestRecordingPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
    const { result } = await renderHook(() => useVoiceRecorder());

    await act(async () => {
      await result.current.start();
    });

    expect(recorder.record).not.toHaveBeenCalled();
    expect(result.current.status).toBe('denied');
  });

  it('returns the recording with the duration observed while recording', async () => {
    setRecorderState({ isRecording: true, durationMillis: 4200 });
    const { result } = await renderHook(() => useVoiceRecorder());

    let media;
    await act(async () => {
      media = await result.current.stop();
    });

    expect(media).toEqual({
      kind: 'voice',
      uri: 'file:///cache/voice.m4a',
      mimeType: 'audio/mp4',
      width: null,
      height: null,
      durationMs: 4200,
    });
  });

  it('discards a recording too short to be a message', async () => {
    setRecorderState({ isRecording: true, durationMillis: MediaLimits.voice.minDurationMs - 1 });
    const { result } = await renderHook(() => useVoiceRecorder());

    let media;
    await act(async () => {
      media = await result.current.stop();
    });

    expect(media).toBeNull();
    expect(deleteFile).toHaveBeenCalled();
  });

  it('deletes the file on cancel', async () => {
    setRecorderState({ isRecording: true, durationMillis: 9000 });
    const { result } = await renderHook(() => useVoiceRecorder());

    await act(async () => {
      await result.current.cancel();
    });

    expect(recorder.stop).toHaveBeenCalled();
    expect(deleteFile).toHaveBeenCalled();
  });

  it('restores the audio session after recording so playback is not silenced', async () => {
    setRecorderState({ isRecording: true, durationMillis: 3000 });
    const { result } = await renderHook(() => useVoiceRecorder());

    await act(async () => {
      await result.current.stop();
    });

    expect(setAudioModeAsync).toHaveBeenLastCalledWith({
      allowsRecording: false,
      playsInSilentMode: true,
    });
  });

  it('normalises the metering level into 0..1 for a waveform', async () => {
    setRecorderState({ isRecording: true, metering: -30 });
    const { result } = await renderHook(() => useVoiceRecorder());

    expect(result.current.level).toBeCloseTo(0.5);
  });

  it('stops a recording left running when the screen unmounts', async () => {
    setRecorderState({ isRecording: true, durationMillis: 1000 });
    recorder.isRecording = true;
    const { unmount } = await renderHook(() => useVoiceRecorder());

    await unmount();

    expect(recorder.stop).toHaveBeenCalled();
  });
});
