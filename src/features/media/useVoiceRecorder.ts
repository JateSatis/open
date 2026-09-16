import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';

import { MediaLimits } from './constants';
import type { LocalMedia } from './types';

/**
 * Voice is speech, not music: mono at 64 kbps is indistinguishable here from
 * the stereo 128 kbps preset and roughly a quarter of the bytes — on what is
 * likely the most frequently sent media type in the app.
 */
export const VoiceRecordingOptions: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 64_000,
  isMeteringEnabled: true,
};

/** How often the duration and the level are refreshed while recording. */
const STATE_POLL_MS = 100;

export type VoiceRecorderStatus = 'idle' | 'recording' | 'denied';

export type VoiceRecorder = {
  status: VoiceRecorderStatus;
  durationMs: number;
  /**
   * Input level normalised to 0..1 for a waveform, or `null` before the first
   * sample. Metering is reported in dBFS, which is negative and unbounded.
   */
  level: number | null;
  start: () => Promise<void>;
  /** Resolves to `null` if nothing usable was recorded. */
  stop: () => Promise<LocalMedia | null>;
  cancel: () => Promise<void>;
};

/** dBFS below this is silence as far as a waveform is concerned. */
const METERING_FLOOR_DB = -60;

function normalizeLevel(metering: number | undefined): number | null {
  if (metering === undefined) {
    return null;
  }

  const clamped = Math.max(METERING_FLOOR_DB, Math.min(0, metering));

  return 1 - clamped / METERING_FLOOR_DB;
}

function deleteQuietly(uri: string): void {
  try {
    new File(uri).delete();
  } catch {
    // A discarded recording that outlives us is cache the OS will reclaim;
    // failing the cancel over it would be worse.
  }
}

/**
 * Recording a voice message, without any assumption about the UI around it:
 * a hold-to-talk button and a tap-to-start recorder both drive the same hook.
 *
 * The maximum duration is not enforced here: the hook reports `durationMs` and
 * the component that owns the UI decides what to do when the limit is reached,
 * since stopping and sending versus stopping and warning is a product choice.
 */
export function useVoiceRecorder(): VoiceRecorder {
  const recorder = useAudioRecorder(VoiceRecordingOptions);
  const recorderState = useAudioRecorderState(recorder, STATE_POLL_MS);
  const [status, setStatus] = useState<VoiceRecorderStatus>('idle');

  // `stop()` clears the recorder state, so the duration has to be read from
  // the last poll before stopping rather than after it.
  const durationRef = useRef(0);

  if (recorderState.isRecording) {
    durationRef.current = recorderState.durationMillis;
  }

  const start = useCallback(async () => {
    const permission = await requestRecordingPermissionsAsync();

    if (!permission.granted) {
      setStatus('denied');
      return;
    }

    // iOS routes audio to the earpiece and silences playback unless the
    // session is switched to a recording mode first.
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();

    durationRef.current = 0;
    recorder.record();
    setStatus('recording');
  }, [recorder]);

  const finish = useCallback(async () => {
    await recorder.stop();
    // Leaving the session in recording mode keeps later playback quiet on iOS.
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    setStatus('idle');

    return { uri: recorder.uri, durationMs: durationRef.current };
  }, [recorder]);

  const stop = useCallback(async (): Promise<LocalMedia | null> => {
    const { uri, durationMs } = await finish();

    if (!uri) {
      return null;
    }

    // An accidental tap produces a fraction of a second of nothing; sending it
    // as a message would only be noise in the chat and in the feed.
    if (durationMs < MediaLimits.voice.minDurationMs) {
      deleteQuietly(uri);
      return null;
    }

    return {
      kind: 'voice',
      uri,
      mimeType: 'audio/mp4',
      width: null,
      height: null,
      durationMs,
    };
  }, [finish]);

  const cancel = useCallback(async () => {
    const { uri } = await finish();

    if (uri) {
      deleteQuietly(uri);
    }
  }, [finish]);

  // A recording left running when the screen goes away keeps the microphone
  // open and the file growing, so unmounting always discards it.
  useEffect(() => {
    return () => {
      if (recorder.isRecording) {
        recorder.stop().catch(() => undefined);
      }
    };
  }, [recorder]);

  return {
    status,
    durationMs: recorderState.isRecording ? recorderState.durationMillis : durationRef.current,
    level: normalizeLevel(recorderState.metering),
    start,
    stop,
    cancel,
  };
}
