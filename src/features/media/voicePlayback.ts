import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { resolveVoiceUri } from './voiceCache';

/**
 * Один плеер голосовых на всё приложение, а не по плееру на облачко.
 *
 * Отсюда сразу два правила продукта: одновременно играет только одно
 * голосовое (запуск другого — это смена источника у того же плеера), и
 * воспроизведение не обрывается, когда облачко уехало за экран и список
 * его размонтировал: плеер облачку не принадлежит. Останавливает его тот,
 * кто владеет экраном (чат при закрытии), или запись нового голосового.
 */

/** Как часто плеер сообщает позицию: хватает на плавную волну и секунды. */
const STATUS_INTERVAL_MS = 100;

export type VoicePlaybackState = {
  /** Чьё голосовое сейчас в плеере — ключ, который передал вызывающий. */
  activeKey: string | null;
  playing: boolean;
  /** Файл качается или буферизуется: кнопка показывает загрузку. */
  loading: boolean;
  positionMs: number;
  /** От плеера, когда файл загружен; до этого — длительность из базы. */
  durationMs: number;
  /** Последний запуск не удался (файла нет, сети нет). */
  failedKey: string | null;
};

const INITIAL: VoicePlaybackState = {
  activeKey: null,
  playing: false,
  loading: false,
  positionMs: 0,
  durationMs: 0,
  failedKey: null,
};

export const useVoicePlaybackStore = create<VoicePlaybackState>(() => INITIAL);

const setState = useVoicePlaybackStore.setState;
const getState = useVoicePlaybackStore.getState;

let player: AudioPlayer | null = null;
/** Позиция, на которую перемотать, как только файл загрузится. */
let pendingSeekMs: number | null = null;
/** Каждый запуск получает номер: ответ устаревшей загрузки не трогает плеер. */
let generation = 0;
let audioModeReady = false;

function onStatus(status: AudioStatus) {
  const state = getState();

  if (!state.activeKey) return;

  if (status.isLoaded && pendingSeekMs !== null) {
    const seekMs = pendingSeekMs;

    pendingSeekMs = null;
    void player?.seekTo(seekMs / 1000);
  }

  if (status.didJustFinish) {
    // Дослушали — облачко возвращается к началу и снова показывает длительность.
    setState({ ...INITIAL });
    return;
  }

  setState({
    playing: status.playing,
    loading: !status.isLoaded || (status.isBuffering && !status.playing),
    positionMs: pendingSeekMs ?? status.currentTime * 1000,
    durationMs: status.duration > 0 ? status.duration * 1000 : state.durationMs,
  });
}

function ensurePlayer(): AudioPlayer {
  if (!player) {
    player = createAudioPlayer(null, { updateInterval: STATUS_INTERVAL_MS });
    player.addListener('playbackStatusUpdate', onStatus);
  }

  return player;
}

export type PlayVoiceInput = {
  key: string;
  /** Публичный URL или локальный `file://` (своё только что записанное). */
  uri: string;
  /** Из `attachments.duration_ms`: до загрузки файла другой длительности нет. */
  durationMs: number | null;
  /** Начать не с начала, а с доли 0..1 — тап по волне неактивного голосового. */
  fromFraction?: number;
};

export async function playVoice({ key, uri, durationMs, fromFraction }: PlayVoiceInput) {
  const current = ++generation;
  const knownMs = durationMs ?? 0;
  const startMs = fromFraction !== undefined ? fromFraction * knownMs : 0;

  ensurePlayer().pause();
  pendingSeekMs = startMs > 0 ? startMs : null;
  setState({
    activeKey: key,
    playing: false,
    loading: true,
    positionMs: startMs,
    durationMs: knownMs,
    failedKey: null,
  });

  try {
    if (!audioModeReady) {
      // Голосовое слышно и в беззвучном режиме iPhone: человек сам нажал play.
      await setAudioModeAsync({ playsInSilentMode: true });
      audioModeReady = true;
    }

    const localUri = await resolveVoiceUri(uri);

    if (current !== generation) return;

    const audio = ensurePlayer();

    audio.replace({ uri: localUri });
    audio.play();
  } catch {
    if (current !== generation) return;

    pendingSeekMs = null;
    setState({ ...INITIAL, failedKey: key });
  }
}

/** Кнопка play/pause облачка. */
export function toggleVoice(input: PlayVoiceInput) {
  const state = getState();

  if (state.activeKey !== input.key) {
    void playVoice(input);
    return;
  }

  // Тап во время загрузки — передумал слушать: загрузка не превращается в
  // внезапный звук через несколько секунд.
  if (state.loading && !state.playing) {
    stopVoice();
    return;
  }

  const audio = ensurePlayer();

  if (state.playing) {
    audio.pause();
    setState({ playing: false });
    return;
  }

  audio.play();
  setState({ playing: true });
}

/** Перемотка по волне: у играющего — сразу, у остального — запуск с этого места. */
export function seekVoice(input: PlayVoiceInput, fraction: number) {
  const clamped = Math.min(1, Math.max(0, fraction));
  const state = getState();

  if (state.activeKey !== input.key) {
    void playVoice({ ...input, fromFraction: clamped });
    return;
  }

  const positionMs = clamped * state.durationMs;

  setState({ positionMs });

  if (state.loading) {
    pendingSeekMs = positionMs;
    return;
  }

  void ensurePlayer().seekTo(positionMs / 1000);
}

/** Закрыли чат, начали запись — голосовое замолкает. */
export function stopVoice() {
  generation += 1;
  pendingSeekMs = null;
  player?.pause();

  if (getState().activeKey !== null || getState().failedKey !== null) setState({ ...INITIAL });
}

export type VoicePlaybackView = {
  isActive: boolean;
  playing: boolean;
  loading: boolean;
  failed: boolean;
  positionMs: number;
  durationMs: number;
};

/**
 * Состояние плеера глазами одного облачка. Позиция меняется десять раз в
 * секунду, но перерисовывается только облачко, которое сейчас играет:
 * у остальных селектор отдаёт одно и то же.
 */
export function useVoicePlayback(key: string): VoicePlaybackView {
  return useVoicePlaybackStore(
    useShallow((state) => {
      const isActive = state.activeKey === key;

      return {
        isActive,
        playing: isActive && state.playing,
        loading: isActive && state.loading,
        failed: state.failedKey === key,
        positionMs: isActive ? state.positionMs : 0,
        durationMs: isActive ? state.durationMs : 0,
      };
    }),
  );
}
