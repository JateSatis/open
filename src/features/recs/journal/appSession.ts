import { deviceContext } from './device';
import { closeChatJournal } from './chatJournal';
import { commentsTargetChanged } from './commentsJournal';
import { journal } from './journal';
import { endPopImpression } from './popJournal';
import { resetJournalQueries } from './searchJournal';
import { flushVoicePlayback } from './voiceJournal';
import { randomUuid } from '@/lib/uuid';

export const SESSION_GAP_MS = 5 * 60_000;
type SessionEntry = 'cold' | 'link' | 'resume' | 'account';

let session: { entry: SessionEntry; startedAt: number } | null = null;
let user: string | null = null;
let announcedFor: string | null = null;
let foregroundSince = 0;
let backgroundSince: number | null = null;
let route: { screen: string; tab: string | null } | null = null;
let splashIsHidden = false;
let screenSince: number | null = null;

function announce() {
  if (!user || !session) return;
  journal.log('app_session_start', {
    at: session.startedAt,
    surface: 'app',
    data: { entry: session.entry, ...deviceContext() },
  });
  announcedFor = user;
}

function begin(entry: SessionEntry, now: number) {
  session = { entry, startedAt: now };
  foregroundSince = now;
  journal.setAppSession(randomUuid());
  announce();
}

export function startAppSession(entry: 'cold' | 'link', now: number) {
  if (!session) begin(entry, now);
}

function closeScreen(now: number) {
  if (screenSince !== null && route && now > screenSince) {
    journal.log('screen_time', {
      at: now,
      data: { screen: route.screen, tab: route.tab ?? undefined, ms: now - screenSince },
    });
  }
  screenSince = null;
}

function showScreen(now: number) {
  if (!splashIsHidden || !route || backgroundSince !== null) return;
  if (user) screenSince ??= now;
  journal.showFirstScreen();
}

export function setSessionUser(next: string | null, now = Date.now()) {
  if (next === user) return;
  closeScreen(now);
  // React закроет старые экраны позже. Завершаем накопленные просмотры,
  // пока и очередь, и app_session_id ещё принадлежат прежнему владельцу.
  closeChatJournal(now);
  commentsTargetChanged(null, now);
  endPopImpression('close');
  resetJournalQueries();
  // У каждого владельца своё дерево навигации. Его маршрут придёт из onReady.
  route = null;
  user = next;
  journal.setUser(next);
  if (next && next !== announcedFor) {
    if (announcedFor) begin('account', now);
    else announce();
  }
}

export function splashHidden(now = Date.now()) {
  splashIsHidden = true;
  showScreen(now);
}

export function enterScreen(screen: string, tab: string | null, now = Date.now()) {
  if (route?.screen === screen && route.tab === tab) return;
  closeScreen(now);
  route = { screen, tab };
  showScreen(now);
}

export function appWentBackground(now = Date.now()) {
  if (backgroundSince !== null) return;
  closeScreen(now);
  flushVoicePlayback(now);
  journal.log('app_background', {
    at: now,
    data: { fg_ms: now - foregroundSince, screen: splashIsHidden ? route?.screen : undefined },
  });
  backgroundSince = now;
}

export function appCameForeground(now = Date.now()) {
  if (backgroundSince === null) return;
  const away = now - backgroundSince;
  backgroundSince = null;
  if (away > SESSION_GAP_MS && user && announcedFor) {
    begin('resume', now);
  } else {
    foregroundSince = now;
    journal.log('app_foreground', { at: now, data: { bg_ms: away } });
  }
  showScreen(now);
}

export function resetAppSessionForTests() {
  session = null;
  user = null;
  announcedFor = null;
  backgroundSince = null;
  route = null;
  splashIsHidden = false;
  screenSince = null;
  journal.setAppSession(null);
}
