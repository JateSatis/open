// Показ попа: что человек видел и как. Копит всё в памяти без React —
// плеер присылает время десять раз в секунду, и перерисовка на каждое было бы
// дорогим удовольствием. Наружу — снимок для `impression_progress` /
// `impression_end`.
//
// Определения (контракт для этапов 2–3):
//   watch_ms     чистое время воспроизведения по часам: видео играет, кадр уже
//                был, нет буферизации и перемотки. Паузы и буферизация — мимо;
//   visible_ms   сколько показ шёл (поп — активная страница на переднем плане);
//   coverage     битовая маска сегментов, через которые прошло воспроизведение
//                (сегмент — 1 с, у длинных — 2% длины, не больше 50);
//   loops        сколько раз воспроизведение перешло через конец к началу
//                (`loop = true`): досмотрел до третьего круга — 2;
//   first_frame_ms  от начала показа до первого сдвига времени плеера;
//   buffering_*  остановки на загрузку после первого кадра;
//   pauses       паузы с причиной (`tap` — тап по видео) и позицией;
//   seeks        перемотки ползунком: откуда, куда, длительность жеста и
//                сколько пальцем прошло по времени ролика.

import type { JournalData } from '@/api/recJournal';
import { randomUuid } from '@/lib/uuid';

export type PlayerStatus = 'idle' | 'loading' | 'readyToPlay' | 'error';

export type AudioOutputState = {
  /** 0…1 — громкость медиа на устройстве. */
  volume: number;
  muted: boolean;
  /** speaker | wired | bluetooth | airplay | other. */
  route: string;
};

export type PauseReason = 'tap' | 'comments';

/** Скачок времени больше этого (×скорость) — не воспроизведение, а перемотка. */
const JUMP_MS = 1500;
/** Переход через конец: было не дальше этого от конца, стало не дальше от начала. */
const WRAP_EDGE_MS = 1500;
/** Перемотка короче этого — дрожь пальца, а не перемотка. */
const MIN_SEEK_MS = 300;
/** Списки в снимке — не длиннее: снимок ходит в сеть каждые несколько секунд. */
const LIST_MAX = 30;

/** Длина сегмента карты покрытия — та же формула, что `rec_segment_ms` в базе. */
export function segmentMs(durationMs: number): number {
  return Math.max(1000, Math.ceil(durationMs * 0.02));
}

export function segmentsCount(durationMs: number): number {
  return Math.max(1, Math.ceil(durationMs / segmentMs(durationMs)));
}

type Seek = { from: number; to: number; gesture_ms: number; travel_ms: number };
type Pause = { at: number; ms: number; reason: PauseReason };

export type PopImpression = ReturnType<typeof createPopImpression>;

export function createPopImpression({
  popId,
  durationMs,
  now = Date.now,
}: {
  popId: string;
  durationMs: number;
  now?: () => number;
}) {
  const id = randomUuid();
  const startedAt = now();
  const duration = Math.max(durationMs, 1);
  const segMs = segmentMs(duration);
  const segments = new Uint8Array(segmentsCount(duration));
  const wrapEdge = Math.min(WRAP_EDGE_MS, duration / 3);

  let ended = false;
  let lastTick = startedAt;
  let watchMs = 0;
  let fastMs = 0;
  let rate = 1;
  let playerPlaying = false;
  let status: PlayerStatus = 'idle';
  let firstFrameMs: number | null = null;
  let firstRawPos: number | null = null;
  let lastPos: number | null = null;
  let maxPos = 0;
  let loops = 0;
  let error: string | null = null;

  let bufferingSince: number | null = null;
  let bufferingCount = 0;
  let bufferingMs = 0;

  let pauseSince: number | null = null;
  let pauseReason: PauseReason = 'tap';
  let pauseAt = 0;
  let pausesCount = 0;
  let pauseMs = 0;
  const pauseReasons: Partial<Record<PauseReason, number>> = {};
  const pauseList: Pause[] = [];

  let scrubbing = false;
  let scrubFrom = 0;
  let scrubSince = 0;
  let scrubLast = 0;
  let scrubTravel = 0;
  const seeks: Seek[] = [];
  let seeksBack = 0;
  let seeksFwd = 0;
  let seekBackMs = 0;
  let seekFwdMs = 0;

  let audio: AudioOutputState | null = null;
  let volumeStart: number | null = null;
  let volumeMin: number | null = null;
  let volumeMax: number | null = null;
  let mutedAny = false;
  const volumeChanges: { t: number; v: number; m: boolean }[] = [];
  const routeChanges: { t: number; r: string }[] = [];

  const clampPos = (ms: number) => Math.min(Math.max(ms, 0), duration);
  const counting = () =>
    !ended && playerPlaying && firstFrameMs !== null && bufferingSince === null && !scrubbing;

  const tick = () => {
    const t = now();

    if (counting()) {
      watchMs += t - lastTick;

      if (rate > 1) fastMs += t - lastTick;
    }

    lastTick = t;
  };

  /** Пройден отрезок [from, to): сегмент, на границе которого остановились, ещё не начат. */
  const mark = (fromMs: number, toMs: number) => {
    const from = clampPos(fromMs);
    const to = clampPos(toMs);

    if (to <= from) return;

    const first = Math.floor(from / segMs);
    const last = Math.floor((to - 1) / segMs);

    for (let i = first; i <= last && i < segments.length; i += 1) segments[i] = 1;
  };

  const closeBuffering = () => {
    if (bufferingSince === null) return;

    bufferingMs += now() - bufferingSince;
    bufferingSince = null;
  };

  const closePause = () => {
    if (pauseSince === null) return;

    const ms = now() - pauseSince;

    pauseMs += ms;
    pauseReasons[pauseReason] = (pauseReasons[pauseReason] ?? 0) + ms;

    if (pauseList.length < LIST_MAX)
      pauseList.push({ at: Math.round(pauseAt), ms, reason: pauseReason });

    pauseSince = null;
  };

  const coverage = () => segments.reduce((sum, bit, i) => (bit ? sum + 2 ** i : sum), 0);

  const snapshot = (): JournalData => {
    tick();

    const t = now();
    const openPause = pauseSince !== null ? t - pauseSince : 0;
    const openBuffering = bufferingSince !== null ? t - bufferingSince : 0;

    return {
      visible_ms: t - startedAt,
      watch_ms: Math.round(watchMs),
      max_pos_ms: Math.round(maxPos),
      coverage: coverage(),
      loops,
      pauses: pausesCount,
      pause_ms: pauseMs + openPause,
      pause_reasons:
        pauseSince !== null
          ? { ...pauseReasons, [pauseReason]: (pauseReasons[pauseReason] ?? 0) + openPause }
          : { ...pauseReasons },
      pause_list: pauseList,
      seeks,
      seeks_back: seeksBack,
      seeks_fwd: seeksFwd,
      seek_back_ms: Math.round(seekBackMs),
      seek_fwd_ms: Math.round(seekFwdMs),
      first_frame_ms: firstFrameMs ?? undefined,
      buffering_count: bufferingCount,
      buffering_ms: bufferingMs + openBuffering,
      error: error ?? undefined,
      fast_ms: Math.round(fastMs),
      volume_min: volumeMin ?? undefined,
      volume_max: volumeMax ?? undefined,
      volume_start: volumeStart ?? undefined,
      muted: audio ? mutedAny : undefined,
      route: audio?.route,
      volume_changes: volumeChanges,
      route_changes: routeChanges,
    };
  };

  return {
    id,
    popId,
    startedAt,

    /** Время плеера, секунды. */
    onTime(seconds: number) {
      if (ended) return;

      const pos = clampPos(seconds * 1000);

      if (firstFrameMs === null) {
        if (firstRawPos === null) firstRawPos = pos;
        else if (pos !== firstRawPos) {
          firstFrameMs = now() - startedAt;
          lastTick = now();
        }
      }

      tick();

      if (scrubbing) {
        lastPos = pos;
        return;
      }

      if (lastPos !== null && firstFrameMs !== null) {
        const delta = pos - lastPos;

        if (delta > 0 && delta <= JUMP_MS * rate) {
          mark(lastPos, pos);
        } else if (delta < 0 && lastPos >= duration - wrapEdge && pos <= wrapEdge) {
          loops += 1;
          mark(lastPos, duration);
          mark(0, pos);
        }
      }

      maxPos = Math.max(maxPos, pos);
      lastPos = pos;
    },

    onPlaying(isPlaying: boolean) {
      tick();
      playerPlaying = isPlaying;
    },

    onStatus(next: PlayerStatus, message?: string) {
      tick();

      if (next === 'loading' && firstFrameMs !== null && bufferingSince === null) {
        bufferingSince = now();
        bufferingCount += 1;
      } else if (next !== 'loading') {
        closeBuffering();
      }

      if (next === 'error') error = message ?? 'error';

      status = next;
    },

    /** Скорость: 2× — пока держат палец. */
    setRate(next: number) {
      tick();
      rate = next;
    },

    /** Видео остановлено по воле человека или открытыми комментариями. */
    setPaused(paused: boolean, reason: PauseReason = 'tap') {
      if (ended) return;

      tick();

      if (paused && pauseSince === null) {
        pauseSince = now();
        pauseReason = reason;
        pauseAt = lastPos ?? 0;
        pausesCount += 1;
      } else if (!paused) {
        closePause();
      }
    },

    scrubStart() {
      if (ended) return;

      tick();
      scrubbing = true;
      scrubFrom = lastPos ?? 0;
      scrubLast = scrubFrom;
      scrubSince = now();
      scrubTravel = 0;
    },

    /** Палец на полосе на позиции ролика `ms`. */
    scrubMove(ms: number) {
      if (!scrubbing) return;

      const pos = clampPos(ms);

      scrubTravel += Math.abs(pos - scrubLast);
      scrubLast = pos;
    },

    scrubEnd(ms: number) {
      if (!scrubbing) return;

      tick();

      const to = clampPos(ms);

      scrubTravel += Math.abs(to - scrubLast);
      scrubbing = false;
      lastPos = to;

      if (Math.abs(to - scrubFrom) < MIN_SEEK_MS) return;

      const shift = Math.abs(to - scrubFrom);

      if (to < scrubFrom) {
        seeksBack += 1;
        seekBackMs += shift;
      } else {
        seeksFwd += 1;
        seekFwdMs += shift;
      }

      if (seeks.length < LIST_MAX) {
        seeks.push({
          from: Math.round(scrubFrom),
          to: Math.round(to),
          gesture_ms: now() - scrubSince,
          travel_ms: Math.round(scrubTravel),
        });
      }
    },

    onAudio(next: AudioOutputState) {
      const t = now() - startedAt;

      if (!audio) {
        volumeStart = next.volume;
      } else {
        if (next.volume !== audio.volume || next.muted !== audio.muted) {
          if (volumeChanges.length < LIST_MAX)
            volumeChanges.push({ t, v: next.volume, m: next.muted });
        }

        if (next.route !== audio.route && routeChanges.length < LIST_MAX) {
          routeChanges.push({ t, r: next.route });
        }
      }

      volumeMin = volumeMin === null ? next.volume : Math.min(volumeMin, next.volume);
      volumeMax = volumeMax === null ? next.volume : Math.max(volumeMax, next.volume);
      mutedAny ||= next.muted;
      audio = next;
    },

    status: () => status,
    isEnded: () => ended,

    snapshot,

    /** Конец показа: итоговый снимок. Повторный вызов отдаёт null. */
    end(): JournalData | null {
      if (ended) return null;

      tick();
      closePause();
      closeBuffering();

      const snap = snapshot();

      ended = true;
      return snap;
    },
  };
}
