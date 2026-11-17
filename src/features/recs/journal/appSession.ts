// Сессии приложения в журнале: начало (холодный старт, возврат, ссылка),
// уход в фон и возвращение, время на каждом экране и вкладке. По ним
// сервер честно посчитает длину сессии и где человек ушёл.
//
// Сессия — от холодного старта до ухода в фон дольше `SESSION_GAP_MS`:
// свернул на минуту ответить в другом приложении — та же сессия.

import { deviceContext } from './device';
import { journal } from './journal';
import { flushVoicePlayback } from './voiceJournal';

import { randomUuid } from '@/lib/uuid';

/** Дольше в фоне — по возвращении новая сессия. */
export const SESSION_GAP_MS = 5 * 60_000;

export type SessionEntry = 'cold' | 'resume' | 'link' | 'push' | 'account';

type Screen = { screen: string; tab: string | null; since: number };

let sessionId: string | null = null;
let entry: SessionEntry = 'cold';
let announced = false;
/** От чьего имени объявлена сессия. Другой человек — другая сессия. */
let announcedFor: string | null = null;
let foregroundSince = Date.now();
let backgroundSince: number | null = null;
let screen: Screen | null = null;

function begin(next: SessionEntry, now: number) {
  sessionId = randomUuid();
  entry = next;
  announced = false;
  foregroundSince = now;
  journal.setAppSession(sessionId);

  if (announcedFor) announce(announcedFor, now);
}

/**
 * Начало сессии уходит, когда известен человек: до входа писать не от кого.
 * Вошёл другой человек — для него новая сессия.
 */
export function announce(userId: string, now = Date.now()): void {
  if (!sessionId) return;

  if (announced && announcedFor !== userId) {
    announcedFor = userId;
    begin('account', now);
    return;
  }

  if (announced) return;

  if (journal.log('app_session_start', { surface: 'app', data: { entry, ...deviceContext() } })) {
    announced = true;
    announcedFor = userId;
  }
}

/** Вход уточнился (ссылку система отдаёт чуть позже старта) — если начало ещё не ушло. */
export function refineEntry(next: SessionEntry): void {
  if (!announced) entry = next;
}

/** Холодный старт. `link` — открыли ссылкой. */
export function startAppSession(how: SessionEntry = 'cold', now = Date.now()): void {
  if (sessionId) return;

  begin(how, now);
}

function closeScreen(now: number) {
  if (!screen) return;

  const ms = now - screen.since;

  if (ms > 0) {
    journal.log('screen_time', {
      at: now,
      data: { screen: screen.screen, tab: screen.tab ?? undefined, ms },
    });
  }
}

export function leaveScreen(now = Date.now()) {
  if (backgroundSince === null) closeScreen(now);
  screen = null;
}

/** Человек перешёл на другой экран. */
export function enterScreen(name: string, tab: string | null, now = Date.now()): void {
  if (screen?.screen === name && screen.tab === tab) return;

  closeScreen(now);
  screen = { screen: name, tab, since: now };
}

export function appWentBackground(now = Date.now()): void {
  if (backgroundSince !== null) return;

  closeScreen(now);
  flushVoicePlayback(now);

  if (screen) screen = { ...screen, since: now };

  journal.log('app_background', {
    at: now,
    data: { fg_ms: now - foregroundSince, screen: screen?.screen },
  });
  backgroundSince = now;
}

export function appCameForeground(now = Date.now()): void {
  if (backgroundSince === null) return;

  const away = now - backgroundSince;

  backgroundSince = null;

  if (screen) screen = { ...screen, since: now };

  if (away > SESSION_GAP_MS) {
    begin('resume', now);
  } else {
    foregroundSince = now;
    journal.log('app_foreground', { at: now, data: { bg_ms: away } });
  }
}

/** Для тестов: забыть сессию. */
export function resetAppSessionForTests(): void {
  sessionId = null;
  announced = false;
  announcedFor = null;
  backgroundSince = null;
  screen = null;
  journal.setAppSession(null);
}
