import {
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  type RecordingOptions,
  type RecordingStatus,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { MediaLimits } from './constants';
import { downsampleWaveform } from './lib/waveform';
import {
  getMicrophoneAccess,
  requestMicrophoneAccess,
  type MicrophoneAccess,
} from './microphoneAccess';
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

/** Сколько последних уровней держать для живой волны на полосе записи. */
export const RECENT_LEVELS = 16;

/**
 * Готовить рекордер заранее — только на Android. Там подготовка создаёт
 * `MediaRecorder`, но не открывает микрофон, и старт после неё мгновенный.
 * На iOS подготовка переключает аудиосессию в режим записи, а в нём
 * голосовые в чате играли бы тише и не туда, поэтому там она идёт в момент
 * касания.
 */
function prepareAheadOnThisPlatform(): boolean {
  return Platform.OS === 'android';
}

export type VoiceRecorderStatus = 'idle' | 'starting' | 'recording';

/**
 * Итог попытки начать запись. `needs-permission` — диалог разрешения был
 * показан, запись не начата: палец всё равно уже ушёл на системное окно.
 */
export type StartResult = 'started' | 'needs-permission' | 'blocked' | 'failed';

export type VoiceRecorderOptions = {
  /**
   * Запись оборвалась не по воле пользователя: приложение ушло в фон, звонок,
   * сбой рекордера. Файл к этому моменту уже удалён.
   */
  onInterrupted?: () => void;
};

export type VoiceRecorder = {
  status: VoiceRecorderStatus;
  durationMs: number;
  /**
   * Input level normalised to 0..1 for a waveform, or `null` before the first
   * sample. Metering is reported in dBFS, which is negative and unbounded.
   */
  level: number | null;
  /** Последние уровни 0..1, старые первыми, — живая волна на полосе записи. */
  recentLevels: number[];
  /** Последнее известное состояние доступа к микрофону, `null` — ещё не узнавали. */
  access: MicrophoneAccess | null;
  start: () => Promise<StartResult>;
  /** Resolves to `null` if nothing usable was recorded. */
  stop: () => Promise<LocalMedia | null>;
  cancel: () => Promise<void>;
};

type LiveState = { durationMs: number; level: number | null; recentLevels: number[] };

const NO_LEVELS: number[] = [];
const IDLE_LIVE: LiveState = { durationMs: 0, level: null, recentLevels: NO_LEVELS };

/** dBFS below this is silence as far as a waveform is concerned. */
const METERING_FLOOR_DB = -60;

export function normalizeLevel(metering: number | undefined): number | null {
  if (metering === undefined) {
    return null;
  }

  const clamped = Math.max(METERING_FLOOR_DB, Math.min(0, metering));

  return 1 - clamped / METERING_FLOOR_DB;
}

function deleteQuietly(uri: string | null): void {
  if (!uri) return;

  try {
    const file = new File(uri);

    if (file.exists) file.delete();
  } catch {
    // A discarded recording that outlives us is cache the OS will reclaim;
    // failing the cancel over it would be worse.
  }
}

/**
 * Recording a voice message, without any assumption about the UI around it:
 * the hold-to-talk button drives it today, a locked recording or a recorder in
 * comments tomorrow.
 *
 * The maximum duration is not enforced here: the hook reports `durationMs` and
 * the component that owns the UI decides what to do when the limit is reached,
 * since stopping and sending versus stopping and warning is a product choice.
 */
export function useVoiceRecorder({ onInterrupted }: VoiceRecorderOptions = {}): VoiceRecorder {
  const statusRef = useRef<VoiceRecorderStatus>('idle');
  const onInterruptedRef = useRef(onInterrupted);
  const [status, setStatusState] = useState<VoiceRecorderStatus>('idle');
  const [access, setAccess] = useState<MicrophoneAccess | null>(null);
  // Каждый сэмпл уровня за запись — из них потом собирается форма волны.
  const levelsRef = useRef<number[]>([]);
  const preparedRef = useRef(false);
  const preparingRef = useRef<Promise<void> | null>(null);
  // Мы сами остановили запись — событие «запись закончилась» от рекордера
  // тогда не прерывание, а ответ на наш stop.
  const stoppingRef = useRef(false);
  // Выбросить запись и сказать об этом — собирается ниже, когда есть `cancel`.
  const interruptRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    onInterruptedRef.current = onInterrupted;
  }, [onInterrupted]);

  const setStatus = useCallback((next: VoiceRecorderStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const handleRecorderStatus = useCallback((event: RecordingStatus) => {
    if (statusRef.current !== 'recording' || stoppingRef.current) return;

    // Рекордер закончил сам или упал, пока мы его не трогали: звонок, сброс
    // медиасервисов, системная ошибка. Такая запись не сообщение.
    if (event.hasError || event.isFinished || event.mediaServicesDidReset) {
      interruptRef.current();
    }
  }, []);

  const recorder = useAudioRecorder(VoiceRecordingOptions, handleRecorderStatus);
  const [live, setLive] = useState<LiveState>(IDLE_LIVE);

  // Свой опрос вместо `useAudioRecorderState`: каждый сэмпл уровня нужен не
  // только для отрисовки, но и для формы волны, и терять его между
  // перерисовками нельзя.
  useEffect(() => {
    if (status !== 'recording') return;

    const timer = setInterval(() => {
      const current = recorder.getStatus();
      const level = normalizeLevel(current.metering);

      if (level !== null) levelsRef.current.push(level);

      setLive((previous) => ({
        durationMs: current.durationMillis,
        level,
        recentLevels:
          level === null
            ? previous.recentLevels
            : [...previous.recentLevels.slice(1 - RECENT_LEVELS), level],
      }));
    }, STATE_POLL_MS);

    return () => clearInterval(timer);
  }, [recorder, status]);

  const prepare = useCallback(async () => {
    if (preparedRef.current) return;
    if (preparingRef.current) return preparingRef.current;

    preparingRef.current = (async () => {
      try {
        await recorder.prepareToRecordAsync();
        preparedRef.current = true;
      } finally {
        preparingRef.current = null;
      }
    })();

    return preparingRef.current;
  }, [recorder]);

  const prepareAhead = useCallback(() => {
    if (!prepareAheadOnThisPlatform()) return;

    prepare().catch(() => {
      // Не вышло заранее — выйдет в момент касания, чуть медленнее.
    });
  }, [prepare]);

  // Узнаём доступ сразу: с ним решается, можно ли готовить рекордер заранее.
  useEffect(() => {
    let active = true;

    getMicrophoneAccess()
      .then((current) => {
        if (!active) return;

        setAccess(current);
        if (current === 'granted') {
          // Android: режим записи безвреден для воспроизведения и больше не
          // стоит времени в момент касания.
          void setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true }).catch(
            () => undefined,
          );
          prepareAhead();
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [prepareAhead]);

  const start = useCallback(async (): Promise<StartResult> => {
    if (statusRef.current !== 'idle') return 'failed';

    let current = access === 'granted' ? access : await getMicrophoneAccess();

    if (current !== 'granted') {
      // Первое касание без разрешения только спрашивает: записывать в этот
      // момент нечего, палец уже на системном диалоге.
      if (current === 'undetermined') current = await requestMicrophoneAccess();

      setAccess(current);

      if (current === 'granted') prepareAhead();

      return current === 'blocked' ? 'blocked' : 'needs-permission';
    }

    setStatus('starting');
    setLive(IDLE_LIVE);
    levelsRef.current = [];

    try {
      if (Platform.OS === 'ios') {
        // iOS routes audio to the earpiece and silences playback unless the
        // session is switched to a recording mode first.
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      }

      await prepare();
      recorder.record();
      preparedRef.current = false;
      setStatus('recording');

      return 'started';
    } catch {
      preparedRef.current = false;
      setStatus('idle');

      return 'failed';
    }
  }, [access, prepare, prepareAhead, recorder, setStatus]);

  const finish = useCallback(async () => {
    // Длительность берётся у рекордера прямо перед остановкой: после stop()
    // его состояние обнуляется, а последний опрос мог отстать на 100 мс.
    const durationMs = recorder.getStatus().durationMillis;

    stoppingRef.current = true;

    try {
      await recorder.stop();
    } finally {
      stoppingRef.current = false;
    }

    if (Platform.OS === 'ios') {
      // Leaving the session in recording mode keeps later playback quiet on iOS.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    }

    setStatus('idle');
    prepareAhead();

    return { uri: recorder.uri, durationMs, levels: levelsRef.current };
  }, [prepareAhead, recorder, setStatus]);

  const stop = useCallback(async (): Promise<LocalMedia | null> => {
    if (statusRef.current !== 'recording') return null;

    const { uri, durationMs, levels } = await finish();

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
      waveform: downsampleWaveform(levels),
    };
  }, [finish]);

  const cancel = useCallback(async () => {
    if (statusRef.current !== 'recording') return;

    const { uri } = await finish();

    deleteQuietly(uri);
  }, [finish]);

  useEffect(() => {
    interruptRef.current = () => {
      void cancel().finally(() => onInterruptedRef.current?.());
    };
  }, [cancel]);

  // Ушли в фон посреди записи — запись выбрасывается: отправлять то, что
  // человек не видел, как записывал, нельзя, а держать микрофон в фоне — тем
  // более.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && statusRef.current === 'recording') interruptRef.current();
    });

    return () => subscription.remove();
  }, []);

  // A recording left running when the screen goes away keeps the microphone
  // open and the file growing, so unmounting always discards it. Заранее
  // подготовленный файл тоже убираем: он пустой и никому не нужен.
  useEffect(() => {
    return () => {
      const uri = recorder.uri;

      if (recorder.isRecording) {
        recorder
          .stop()
          .catch(() => undefined)
          .finally(() => deleteQuietly(uri));
        return;
      }

      if (preparedRef.current) deleteQuietly(uri);
    };
  }, [recorder]);

  const recording = status === 'recording';

  return {
    status,
    durationMs: recording ? live.durationMs : 0,
    level: recording ? live.level : null,
    recentLevels: recording ? live.recentLevels : NO_LEVELS,
    access,
    start,
    stop,
    cancel,
  };
}
