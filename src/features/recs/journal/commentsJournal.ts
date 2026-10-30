// Сессия панели комментариев в журнале: открыта и закрыта, откуда, что в
// ней показалось, куда прокрутили, какие треды комментариев раскрыли, переход по цитате,
// видел ли закреплённый, что было с полем ввода. Панель общая для сообщений
// и попсов — и сессия тоже. Текст черновика не пишется, только длина.

import { journal } from './journal';
import { currentPopPlayback } from './popJournal';

import type { CommentsPanelTarget } from '@/features/interactions/comments/commentsPanelStore';

type ComposerOutcome = 'none' | 'focused' | 'abandoned' | 'sent';

type Session = {
  target: CommentsPanelTarget;
  openedAt: number;
  impressionId?: string;
  videoPosMs?: number;
  videoPlaying?: boolean;
  shown: Set<string>;
  maxDepth: number;
  commentThreads: Set<string>;
  repliesShown: Set<string>;
  quotesFollowed: number;
  pinnedSeen: boolean;
  focused: boolean;
  typingSince: number | null;
  typingMs: number;
  typed: boolean;
  sent: number;
  sentChars: number;
  voiceStarted: number;
  voiceSent: number;
  voiceActivityAt: number | null;
};

/** Список показанных id в событии — не длиннее. */
const SHOWN_IDS_MAX = 100;

let session: Session | null = null;

function openedFrom(target: CommentsPanelTarget): string {
  if (target.fragment) return target.fragment.kind === 'cluster' ? 'cluster' : 'area';
  if (target.subject.type === 'pop') return 'pop';
  if (target.focusCommentId) return 'comment_link';

  return target.chatId ? 'chat' : 'other';
}

function finish(now: number) {
  if (!session) return;

  const s = session;

  session = null;

  if (s.typingSince !== null) s.typingMs += now - s.typingSince;

  const composer: ComposerOutcome =
    s.sent > 0 ? 'sent' : s.typed ? 'abandoned' : s.focused ? 'focused' : 'none';

  journal.log('comments_session', {
    impressionId: s.impressionId,
    subject: { type: s.target.subject.type, id: s.target.subject.id },
    surface: 'comments',
    data: {
      ms: now - s.openedAt,
      opened_from: openedFrom(s.target),
      fragment: s.target.fragment ? true : undefined,
      video_pos_ms: s.videoPosMs,
      was_playing: s.videoPlaying,
      shown: s.shown.size,
      shown_ids: [...s.shown].slice(0, SHOWN_IDS_MAX),
      max_depth: s.maxDepth,
      threads_expanded: s.commentThreads.size,
      replies_shown: s.repliesShown.size,
      quote_followed: s.quotesFollowed,
      pinned_seen: s.pinnedSeen,
      composer,
      sent: s.sent,
      sent_chars: s.sentChars,
      typing_ms: s.typingMs,
      voice_started: s.voiceStarted,
      voice_sent: s.voiceSent,
      voice_cancelled: Math.max(0, s.voiceStarted - s.voiceSent),
    },
  });
}

/** Панель открылась, сменила цель или закрылась. Та же цель — та же сессия. */
export function commentsTargetChanged(target: CommentsPanelTarget | null, now = Date.now()): void {
  if (
    session &&
    target &&
    session.target.subject.id === target.subject.id &&
    session.target.fragment?.key === target.fragment?.key
  ) {
    session.target = target;
    return;
  }

  finish(now);

  if (!target) return;

  const playback = target.subject.type === 'pop' ? currentPopPlayback(target.subject.id) : null;

  session = {
    target,
    openedAt: now,
    impressionId: playback?.impressionId,
    videoPosMs: playback?.posMs,
    videoPlaying: playback?.playing,
    shown: new Set(),
    maxDepth: 0,
    commentThreads: new Set(),
    repliesShown: new Set(),
    quotesFollowed: 0,
    pinnedSeen: false,
    focused: false,
    typingSince: null,
    typingMs: 0,
    typed: false,
    sent: 0,
    sentChars: 0,
    voiceStarted: 0,
    voiceSent: 0,
    voiceActivityAt: null,
  };
}

export function commentThreadOpened(rootId: string | null): void {
  if (session && rootId) session.commentThreads.add(rootId);
}

/** На экране показались строки списка: верх (`main`) или окно треда комментариев. */
export function commentsShown(
  rows: { id: string; index: number; pinned?: boolean; commentThreadRoot?: boolean }[],
  pane: 'main' | 'commentThread',
): void {
  if (!session) return;

  for (const row of rows) {
    if (pane === 'commentThread' && !row.commentThreadRoot) session.repliesShown.add(row.id);
    else session.shown.add(row.id);

    if (pane === 'main') session.maxDepth = Math.max(session.maxDepth, row.index + 1);
    if (row.pinned) session.pinnedSeen = true;
  }
}

export function commentsQuoteFollowed(): void {
  if (session) session.quotesFollowed += 1;
}

export function commentsComposerFocused(): void {
  if (session) session.focused = true;
}

/** Набирает текст: время набора — от первого символа до отправки или закрытия. */
export function commentsComposerTyping(now = Date.now()): void {
  if (!session) return;

  session.typed = true;
  session.typingSince ??= now;
}

export function commentsComposerSent(chars: number, now = Date.now()): void {
  if (!session) return;

  if (session.typingSince !== null) {
    session.typingMs += now - session.typingSince;
    session.typingSince = null;
  }

  session.sent += 1;
  session.sentChars += chars;
  session.typed = false;
}

/** Пауза в сигналах записи дольше этого — следующая запись, а не та же. */
const VOICE_ACTIVITY_GAP_MS = 3000;

/** Идёт запись голосового — рекордер сигналит, пока пишет. */
export function commentsVoiceActivity(now = Date.now()): void {
  if (!session) return;

  if (session.voiceActivityAt === null || now - session.voiceActivityAt > VOICE_ACTIVITY_GAP_MS) {
    session.voiceStarted += 1;
  }

  session.voiceActivityAt = now;
}

export function commentsVoiceSent(): void {
  if (session) session.voiceSent += 1;
}
