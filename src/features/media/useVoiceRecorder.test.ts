import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { act, renderHook } from '@testing-library/react-native';
import { AppState, Platform, type AppStateStatus } from 'react-native';

import { MediaLimits } from './constants';
import { WAVEFORM_BARS } from './lib/waveform';
import { RECENT_LEVELS, useVoiceRecorder } from './useVoiceRecorder';

jest.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: { extension: '.m4a', sampleRate: 44100 } },
  getRecordingPermissionsAsync: jest.fn(),
  requestRecordingPermissionsAsync: jest.fn(),
  setAudioModeAsync: jest.fn(),
  useAudioRecorder: jest.fn(),
}));

jest.mock('expo-file-system', () => ({ File: jest.fn() }));

const deleteFile = jest.fn();
let recorderStatus = { durationMillis: 0, metering: undefined as number | undefined };
let statusListener: ((event: { isFinished: boolean; hasError: boolean }) => void) | undefined;

const recorder = {
  uri: 'file:///cache/voice.m4a',
  isRecording: false,
  record: jest.fn(),
  stop: jest.fn().mockResolvedValue(undefined),
  prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
  getStatus: jest.fn(() => recorderStatus),
};

function permission(granted: boolean, canAskAgain = true) {
  return { granted, canAskAgain, status: granted ? 'granted' : 'denied', expires: 'never' };
}

let appStateListener: ((state: AppStateStatus) => void) | undefined;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  recorderStatus = { durationMillis: 0, metering: undefined };
  recorder.uri = 'file:///cache/voice.m4a';
  recorder.isRecording = false;
  (useAudioRecorder as jest.Mock).mockImplementation((_options, listener) => {
    statusListener = listener;
    return recorder;
  });
  (getRecordingPermissionsAsync as jest.Mock).mockResolvedValue(permission(true));
  (requestRecordingPermissionsAsync as jest.Mock).mockResolvedValue(permission(true));
  (setAudioModeAsync as jest.Mock).mockResolvedValue(undefined);
  (File as unknown as jest.Mock).mockImplementation(() => ({ delete: deleteFile, exists: true }));
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener as (state: AppStateStatus) => void;
    return { remove: jest.fn() };
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function renderRecorder(onInterrupted?: () => void) {
  const rendered = await renderHook(() => useVoiceRecorder({ onInterrupted }));
  // Первичная проверка доступа — асинхронная.
  await act(async () => undefined);
  return rendered;
}

async function startRecording(result: { current: ReturnType<typeof useVoiceRecorder> }) {
  let outcome;
  await act(async () => {
    outcome = await result.current.start();
  });
  return outcome;
}

/** Опрос рекордера: сколько записано и какой сейчас уровень. */
async function tick(durationMillis: number, metering?: number) {
  recorderStatus = { durationMillis, metering };
  await act(async () => {
    jest.advanceTimersByTime(100);
  });
}

describe('useVoiceRecorder', () => {
  it('starts recording once the microphone is granted', async () => {
    const { result } = await renderRecorder();

    expect(await startRecording(result)).toBe('started');
    expect(recorder.record).toHaveBeenCalled();
    expect(result.current.status).toBe('recording');
  });

  it('prepares the recorder ahead of the touch on Android', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderRecorder();

    expect(recorder.prepareToRecordAsync).toHaveBeenCalledTimes(1);
  });

  it('asks for the microphone on the first press and does not record', async () => {
    (getRecordingPermissionsAsync as jest.Mock).mockResolvedValue(permission(false));
    const { result } = await renderRecorder();

    expect(await startRecording(result)).toBe('needs-permission');
    expect(requestRecordingPermissionsAsync).toHaveBeenCalled();
    expect(recorder.record).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('reports a permanently refused microphone without asking again', async () => {
    (getRecordingPermissionsAsync as jest.Mock).mockResolvedValue(permission(false, false));
    const { result } = await renderRecorder();

    expect(await startRecording(result)).toBe('blocked');
    expect(requestRecordingPermissionsAsync).not.toHaveBeenCalled();
    expect(recorder.record).not.toHaveBeenCalled();
  });

  it('returns the recording with the duration read right before stopping', async () => {
    const { result } = await renderRecorder();
    await startRecording(result);
    recorderStatus = { durationMillis: 4200, metering: -20 };

    let media;
    await act(async () => {
      media = await result.current.stop();
    });

    expect(media).toMatchObject({
      kind: 'voice',
      uri: 'file:///cache/voice.m4a',
      mimeType: 'audio/mp4',
      durationMs: 4200,
    });
  });

  it('builds the waveform from the levels sampled while recording', async () => {
    const { result } = await renderRecorder();
    await startRecording(result);
    await tick(100, -60);
    await tick(200, 0);
    await tick(300, -30);
    recorderStatus = { durationMillis: 1500, metering: -30 };

    let media: { waveform?: number[] | null } | null = null;
    await act(async () => {
      media = await result.current.stop();
    });

    const waveform = media!.waveform!;

    expect(waveform).toHaveLength(WAVEFORM_BARS);
    expect(Math.max(...waveform)).toBe(31);
    expect(Math.min(...waveform)).toBe(0);
  });

  it('keeps a short window of recent levels for the live bar', async () => {
    const { result } = await renderRecorder();
    await startRecording(result);

    for (let index = 1; index <= 30; index += 1) await tick(index * 100, -30);

    expect(result.current.recentLevels).toHaveLength(RECENT_LEVELS);
    expect(result.current.durationMs).toBe(3000);
    expect(result.current.level).toBeCloseTo(0.5);
  });

  it('discards a recording too short to be a message', async () => {
    const { result } = await renderRecorder();
    await startRecording(result);
    recorderStatus = { durationMillis: MediaLimits.voice.minDurationMs - 1, metering: -10 };

    let media;
    await act(async () => {
      media = await result.current.stop();
    });

    expect(media).toBeNull();
    expect(deleteFile).toHaveBeenCalled();
  });

  it('deletes the file on cancel', async () => {
    const { result } = await renderRecorder();
    await startRecording(result);
    recorderStatus = { durationMillis: 9000, metering: -10 };

    await act(async () => {
      await result.current.cancel();
    });

    expect(recorder.stop).toHaveBeenCalled();
    expect(deleteFile).toHaveBeenCalled();
  });

  it('prepares again after a recording, so the next one starts at once', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const { result } = await renderRecorder();
    await startRecording(result);
    recorderStatus = { durationMillis: 3000, metering: -10 };

    await act(async () => {
      await result.current.stop();
    });

    expect(recorder.prepareToRecordAsync).toHaveBeenCalledTimes(2);
  });

  it('throws the recording away when the app leaves the foreground', async () => {
    const onInterrupted = jest.fn();
    const { result } = await renderRecorder(onInterrupted);
    await startRecording(result);

    await act(async () => {
      appStateListener?.('background');
    });

    expect(recorder.stop).toHaveBeenCalled();
    expect(deleteFile).toHaveBeenCalled();
    expect(onInterrupted).toHaveBeenCalled();
  });

  it('throws the recording away when the recorder stops on its own', async () => {
    const onInterrupted = jest.fn();
    const { result } = await renderRecorder(onInterrupted);
    await startRecording(result);

    await act(async () => {
      statusListener?.({ isFinished: true, hasError: true });
    });

    expect(deleteFile).toHaveBeenCalled();
    expect(onInterrupted).toHaveBeenCalled();
  });

  it('does not treat its own stop as an interruption', async () => {
    const onInterrupted = jest.fn();
    const { result } = await renderRecorder(onInterrupted);
    await startRecording(result);
    recorderStatus = { durationMillis: 3000, metering: -10 };
    recorder.stop.mockImplementationOnce(async () => {
      statusListener?.({ isFinished: true, hasError: false });
    });

    await act(async () => {
      await result.current.stop();
    });

    expect(onInterrupted).not.toHaveBeenCalled();
  });

  it('stops a recording left running when the screen unmounts', async () => {
    const { result, unmount } = await renderRecorder();
    await startRecording(result);
    recorder.isRecording = true;

    await unmount();

    expect(recorder.stop).toHaveBeenCalled();
  });
});
