import type { ChatSummary, MessageAttachment, Person } from '@/api/chats';
import type { UserActivity } from '@/features/chats/messages/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function formatMessageTime(iso: string): string {
  const date = new Date(iso);

  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Time for today, weekday within the last week, date beyond that. */
export function formatChatTimestamp(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '';

  const date = new Date(iso);
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) return formatMessageTime(iso);

  if (now.getTime() - date.getTime() < 7 * DAY_MS) return WEEKDAYS[date.getDay()];

  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;
}

/**
 * The other side of a direct chat, or null in a group. Until they accept the
 * invite the other side is not a participant yet — the dialogue is still
 * theirs by name.
 */
export function counterpart(chat: ChatSummary, currentUserId: string | null): Person | null {
  if (chat.kind !== 'direct') return null;

  return (
    chat.participants.find((participant) => participant.id !== currentUserId) ??
    chat.waiting.find((person) => person.id !== currentUserId) ??
    null
  );
}

/** «Марина, Пётр и ещё 2» — для состава чата в одну строку. */
export function listNames(people: Person[], limit = 3): string {
  const names = people.slice(0, limit).map((person) => person.displayName);
  const rest = people.length - names.length;

  return rest > 0 ? `${names.join(', ')} и ещё ${rest}` : names.join(', ');
}

export function chatTitle(chat: ChatSummary, currentUserId: string | null): string {
  if (chat.title) return chat.title;

  const other = counterpart(chat, currentUserId);

  if (other) return other.displayName;

  return chat.kind === 'group' ? 'Групповой чат' : 'Диалог';
}

export function chatAvatarUrl(chat: ChatSummary, currentUserId: string | null): string | null {
  return counterpart(chat, currentUserId)?.avatarUrl ?? null;
}

export function isChatMember(chat: ChatSummary, currentUserId: string | null): boolean {
  if (!currentUserId) return false;

  return chat.participants.some((participant) => participant.id === currentUserId);
}

/** «Аня печатает…», «Аня записывает голосовое…», и во множественном числе. */
export function activityLabel(
  activities: UserActivity[],
  nameOf: (userId: string) => string,
): string | null {
  if (activities.length === 0) return null;

  const allRecording = activities.every((entry) => entry.activity === 'recording_voice');

  if (activities.length === 1) {
    const [{ userId, activity }] = activities;

    return activity === 'recording_voice'
      ? `${nameOf(userId)} записывает голосовое…`
      : `${nameOf(userId)} печатает…`;
  }

  return allRecording ? 'Несколько человек записывают голосовые…' : 'Несколько человек печатают…';
}

/** Картинка для миниатюры сообщения: фото или постер видео из первого вложения. */
export function attachmentThumbnail(attachments: MessageAttachment[]): string | null {
  const [first] = attachments;

  if (!first) return null;
  if (first.mimeType?.startsWith('video/')) return first.posterUrl;
  if (first.mimeType?.startsWith('audio/')) return null;

  return first.url;
}

/**
 * До какого момента переписку прочитали остальные. В групповом чате берём
 * самого отстающего: «прочитано» должно значить «прочитали все».
 */
export function readUpTo(chat: ChatSummary | null, currentUserId: string | null): string | null {
  const others = (chat?.participants ?? []).filter(
    (participant) => participant.id !== currentUserId,
  );

  if (others.length === 0) return null;

  return others.reduce(
    (earliest, participant) =>
      participant.lastReadAt < earliest ? participant.lastReadAt : earliest,
    others[0].lastReadAt,
  );
}

/** Поиск чата по названию и по именам участников — для выбора, куда переслать. */
export function matchesChatQuery(
  chat: ChatSummary,
  query: string,
  currentUserId: string | null,
): boolean {
  const needle = query.trim().toLocaleLowerCase('ru');

  if (!needle) return true;

  const haystack = [
    chatTitle(chat, currentUserId),
    chat.title ?? '',
    ...chat.participants.map((participant) => participant.displayName),
  ];

  return haystack.some((value) => value.toLocaleLowerCase('ru').includes(needle));
}
