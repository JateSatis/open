// Показы попсов в журнале: какой показ идёт сейчас и связь с плеером.
//
// Показ один на приложение: просмотр попсов — один экран, и активна в нём
// одна страница. Плеер страницы и её управление находят показ по id попа —
// у прогреваемой соседней страницы показа нет, её события никуда не идут.

import { currentAudio, currentNetwork, currentOrientation, onAudioChange } from './device';
import { journal, JOURNAL_FLUSH_MS, type JournalSurface } from './journal';
import { createPopImpression, type PlayerStatus, type PopImpression } from './popImpression';

/** Почему показ кончился. `lost` ставит сервер, когда конца не дождался. */
export type PopExit =
  | 'swipe_next'
  | 'swipe_prev'
  | 'channel'
  | 'tab'
  | 'background'
  | 'close'
  | 'navigate'
  | 'replaced';

/** Состояние плеера страницы в момент, когда показ начался. */
export type PlayerProbe = () => { status: PlayerStatus; playing: boolean; seconds: number };

type Current = {
  impression: PopImpression;
  progressTimer: ReturnType<typeof setInterval>;
  stopAudio: () => void;
};

let current: Current | null = null;
const probes = new Map<string, PlayerProbe>();
/** Куда уходит человек — узнаём раньше, чем экран потеряет фокус. */
let pendingExit: PopExit | null = null;

/** Снимок показа уходит раз в столько: убитое приложение теряет не больше. */
export const POP_PROGRESS_MS = JOURNAL_FLUSH_MS;

export function currentPopImpression(popId: string): PopImpression | null {
  return current && current.impression.popId === popId ? current.impression : null;
}

/** Плеер страницы попа: показ, начавшийся при уже готовом плеере, спросит его состояние. */
export function registerPlayerProbe(popId: string, probe: PlayerProbe): () => void {
  probes.set(popId, probe);

  if (current?.impression.popId === popId) applyProbe(current.impression, probe);

  return () => {
    if (probes.get(popId) === probe) probes.delete(popId);
  };
}

function applyProbe(impression: PopImpression, probe: PlayerProbe) {
  const { status, playing, seconds } = probe();

  impression.onStatus(status);
  impression.onPlaying(playing);
  impression.onTime(seconds);
}

export type PopImpressionStart = {
  popId: string;
  durationMs: number;
  surface: JournalSurface;
  /** Откуда пришли к просмотру: сетка канала, пост, выдача поиска… */
  entry: string;
  /** Поля выдачи — заполнит лента этапа 3. */
  feed?: { requestId?: string; position?: number; source?: string; algoVersion?: string };
};

export function beginPopImpression(start: PopImpressionStart): PopImpression {
  if (current) endPopImpression('replaced');

  const impression = createPopImpression({ popId: start.popId, durationMs: start.durationMs });
  const audio = currentAudio();

  if (audio) impression.onAudio(audio);

  journal.log('impression_start', {
    impressionId: impression.id,
    subject: { type: 'pop', id: start.popId },
    surface: start.surface,
    at: impression.startedAt,
    data: {
      entry: start.entry,
      duration_ms: start.durationMs,
      request_id: start.feed?.requestId,
      position: start.feed?.position,
      source: start.feed?.source,
      algo_version: start.feed?.algoVersion,
      volume: audio?.volume,
      muted: audio?.muted,
      route: audio?.route,
      network: currentNetwork(),
      orientation: currentOrientation(),
    },
  });

  current = {
    impression,
    progressTimer: setInterval(() => {
      if (current?.impression === impression) {
        journal.log('impression_progress', { impressionId: impression.id, data: impression.snapshot() });
      }
    }, POP_PROGRESS_MS),
    stopAudio: onAudioChange((state) => impression.onAudio(state)),
  };
  pendingExit = null;

  const probe = probes.get(start.popId);

  if (probe) applyProbe(impression, probe);

  return impression;
}

/** Конец текущего показа. Уже кончился — ничего. */
export function endPopImpression(exit: PopExit): void {
  if (!current) return;

  const { impression, progressTimer, stopAudio } = current;

  current = null;
  clearInterval(progressTimer);
  stopAudio();

  const snapshot = impression.end();

  if (snapshot) {
    journal.log('impression_end', {
      impressionId: impression.id,
      // Фон — всегда фон: отмеченный заранее уход не случился.
      data: { ...snapshot, exit: exit === 'background' ? exit : (pendingExit ?? exit) },
    });
  }

  pendingExit = null;
}

/**
 * Человек уходит из просмотра этим путём — конец показа возьмёт эту причину.
 * Первая отмеченная главнее: переход к каналу тоже закрывает просмотр.
 */
export function notePopExit(exit: PopExit): void {
  if (current && !pendingExit) pendingExit = exit;
}

/** Открыл канал попа. */
export function notePopChannelOpened(popId: string, channelId: string): void {
  const impression = currentPopImpression(popId);

  journal.log('channel_opened', {
    impressionId: impression?.id,
    subject: { type: 'channel', id: channelId },
    data: { pop_id: popId },
  });
  notePopExit('channel');
}

/** Позиция и состояние видео текущего показа — для сессии комментариев. */
export function currentPopPlayback(popId: string): { impressionId: string; posMs: number; playing: boolean } | null {
  const impression = currentPopImpression(popId);
  const probe = probes.get(popId);

  if (!impression) return null;

  const state = probe?.();

  return {
    impressionId: impression.id,
    posMs: Math.round((state?.seconds ?? 0) * 1000),
    playing: state?.playing ?? false,
  };
}
