// Прослушивание голосовых в журнале. Плеер голосовых один на приложение
// (`voicePlayback.ts`), поэтому и учёт один: следим за его состоянием, а
// чьё это голосовое — знает облачко, которое его нарисовало.

import { logVoicePlay } from './chatJournal';

type Listening = {
  key: string;
  messageId: string;
  startedAt: number;
  lastAt: number;
  playing: boolean;
  listenedMs: number;
  maxPosMs: number;
  durationMs: number;
};

/** Ключ плеера (файл голосового) → сообщение. Комментарии сюда не попадают. */
const owners = new Map<string, string>();
const OWNERS_MAX = 500;

let current: Listening | null = null;

export function noteVoiceOwner(key: string, messageId: string): void {
  if (owners.size >= OWNERS_MAX) owners.delete(owners.keys().next().value as string);

  owners.set(key, messageId);
}

function finish(now: number, finished: boolean) {
  if (!current) return;

  const l = current;

  current = null;

  if (l.playing) l.listenedMs += now - l.lastAt;
  if (l.listenedMs <= 0) return;

  const maxPos = finished ? l.durationMs : l.maxPosMs;

  logVoicePlay(l.messageId, {
    ms: now - l.startedAt,
    kind: 'voice',
    listened_ms: Math.round(l.listenedMs),
    duration_ms: Math.round(l.durationMs),
    max_pos_ms: Math.round(maxPos),
    completed: finished || (l.durationMs > 0 && maxPos >= l.durationMs * 0.95),
    rate: 1,
  });
}

/** Состояние общего плеера поменялось. */
export function voicePlaybackChanged(
  state: { activeKey: string | null; playing: boolean; positionMs: number; durationMs: number },
  prev: { activeKey: string | null; positionMs: number; durationMs: number },
  now = Date.now(),
): void {
  if (current && state.activeKey !== current.key) {
    // Дослушанное плеер сбрасывает в начало: позиция была у конца.
    const finished =
      state.activeKey === null && prev.durationMs > 0 && prev.positionMs >= prev.durationMs - 400;

    finish(now, finished);
  }

  if (!state.activeKey) return;

  const messageId = owners.get(state.activeKey);

  if (!messageId) return;

  if (!current) {
    current = {
      key: state.activeKey,
      messageId,
      startedAt: now,
      lastAt: now,
      playing: false,
      listenedMs: 0,
      maxPosMs: 0,
      durationMs: state.durationMs,
    };
  }

  if (current.playing) current.listenedMs += now - current.lastAt;

  current.lastAt = now;
  current.playing = state.playing;
  current.maxPosMs = Math.max(current.maxPosMs, state.positionMs);
  current.durationMs = state.durationMs || current.durationMs;
}

/** Ушли с экрана или в фон — недослушанное записать как есть. */
export function flushVoicePlayback(now = Date.now()): void {
  finish(now, false);
}

export function resetVoiceJournal(now: number) {
  flushVoicePlayback(now);
  owners.clear();
}
