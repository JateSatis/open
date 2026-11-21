// Мессенджер в журнале: сессия экрана чата (сколько, откуда пришёл, кем —
// участником, подписчиком или посетителем), сколько времени каждое
// сообщение было на экране, открытые медиа, прослушанные голосовые и
// кружки, открытые и брошенные выбор реакции и выбор чата для пересылки.
// Засчитанные просмотры сообщений сервер пишет сам — здесь только то,
// чего он не знает.

import { journal } from './journal';
import { flushVoicePlayback, resetVoiceJournal } from './voiceJournal';

import { randomUuid } from '@/lib/uuid';

export type ChatRole = 'member' | 'subscriber' | 'visitor';

type ChatSession = {
  id: string;
  chatId: string;
  entry: string;
  role: ChatRole;
  startedAt: number;
  visible: Map<string, number>;
  dwell: Map<string, number>;
};

/** Сообщений с временем на экране в событии — не больше; остальные — только числом. */
const DWELL_MAX = 100;

let chat: ChatSession | null = null;
/**
 * Что было на экране чата в последний раз. Вернулись на экран без прокрутки
 * — список не скажет о видимом заново, новая сессия начинается с этого.
 */
const lastVisible = new Map<string, string[]>();
const LAST_VISIBLE_CHATS = 20;

export function chatSessionId(): string | null {
  return chat?.id ?? null;
}

export function startChatSession(
  chatId: string,
  entry: string,
  role: ChatRole,
  now = Date.now(),
): void {
  if (chat?.chatId === chatId) return;

  endChatSession(undefined, now);
  chat = {
    id: randomUuid(),
    chatId,
    entry,
    role,
    startedAt: now,
    visible: new Map((lastVisible.get(chatId) ?? []).map((id) => [id, now])),
    dwell: new Map(),
  };
}

/** Роль уточнилась (чат и подписка загружаются после открытия). */
export function updateChatRole(chatId: string, role: ChatRole): void {
  if (chat?.chatId === chatId) chat.role = role;
}

function settle(session: ChatSession, id: string, now: number) {
  const since = session.visible.get(id);

  if (since === undefined) return;

  session.dwell.set(id, (session.dwell.get(id) ?? 0) + now - since);
  session.visible.delete(id);
}

/** Что из сообщений сейчас на экране — целиком. */
export function chatVisibleMessages(chatId: string, ids: string[], now = Date.now()): void {
  lastVisible.delete(chatId);
  lastVisible.set(chatId, ids);

  if (lastVisible.size > LAST_VISIBLE_CHATS)
    lastVisible.delete(lastVisible.keys().next().value as string);

  if (chat?.chatId !== chatId) return;

  const next = new Set(ids);

  for (const id of [...chat.visible.keys()]) {
    if (!next.has(id)) settle(chat, id, now);
  }

  for (const id of next) {
    if (!chat.visible.has(id)) chat.visible.set(id, now);
  }
}

/** Конец сессии чата. С `chatId` — только если идёт сессия этого чата: экран не закрывает чужую. */
export function endChatSession(chatId?: string, now = Date.now()): void {
  if (!chat || (chatId !== undefined && chat.chatId !== chatId)) return;

  flushVoicePlayback(now);

  const session = chat;

  chat = null;
  [...session.visible.keys()].forEach((id) => settle(session, id, now));

  const dwell = [...session.dwell]
    .sort((a, b) => b[1] - a[1])
    .slice(0, DWELL_MAX)
    .map(([id, ms]) => ({ id, ms }));

  journal.log('chat_session', {
    screenSessionId: session.id,
    subject: { type: 'chat', id: session.chatId },
    surface: 'chat',
    data: {
      ms: now - session.startedAt,
      entry: session.entry,
      role: session.role,
      messages_seen: session.dwell.size,
      dwell,
    },
  });
}

/** Посмотрел медиа сообщения: сколько, какое, для видео — сколько из него. */
export function logMediaView(
  messageId: string,
  data: {
    ms: number;
    kind: 'photo' | 'video';
    index: number;
    watch_ms?: number;
    duration_ms?: number;
    completed?: boolean;
  },
): void {
  journal.log('media_view', {
    screenSessionId: chat?.id,
    subject: { type: 'message', id: messageId },
    surface: 'chat',
    data,
  });
}

/** Слушал голосовое или смотрел кружок: сколько, до какого места, на какой скорости. */
export function logVoicePlay(
  messageId: string,
  data: {
    ms: number;
    kind: 'voice' | 'video_note';
    listened_ms: number;
    duration_ms: number;
    max_pos_ms: number;
    completed: boolean;
    rate: number;
  },
): void {
  journal.log('voice_play', {
    screenSessionId: chat?.id,
    subject: { type: 'message', id: messageId },
    surface: 'chat',
    data,
  });
}

/** Выбор реакции открыли и выбрали или бросили. */
export function logReactionPicker(
  subject: { type: 'message' | 'comment' | 'pop'; id: string },
  outcome: 'picked' | 'cancelled',
  ms: number,
  emoji?: string,
): void {
  journal.log('reaction_picker', {
    screenSessionId: chat?.id,
    subject,
    data: { outcome, ms, emoji },
  });
}

let forwardPick: {
  subject: { type: 'message' | 'comment'; id: string };
  items: number;
  at: number;
} | null = null;

/** «Переслать» — открылся выбор чата. `subject` — первое пересылаемое. */
export function forwardPickerOpened(
  subject: { type: 'message' | 'comment'; id: string },
  items: number,
): void {
  forwardPick = { subject, items, at: Date.now() };
}

/** Чат выбран (`picked`) или выбор брошен. */
export function forwardPickerClosed(outcome: 'picked' | 'cancelled'): void {
  if (!forwardPick) return;

  const pick = forwardPick;

  forwardPick = null;
  journal.log('forward_picker', {
    screenSessionId: chat?.id,
    subject: pick.subject,
    data: { outcome, ms: Date.now() - pick.at, items: pick.items },
  });
}

export function closeChatJournal(now: number) {
  forwardPickerClosed('cancelled');
  resetVoiceJournal(now);
  endChatSession(undefined, now);
  lastVisible.clear();
}
