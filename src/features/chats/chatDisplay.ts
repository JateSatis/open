import type { ChatParticipant, ChatSummary } from '@/api/chats';

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

/** The other side of a direct chat, or null in a group. */
export function counterpart(
  chat: ChatSummary,
  currentUserId: string | null,
): ChatParticipant | null {
  if (chat.kind !== 'direct') return null;

  return chat.participants.find((participant) => participant.id !== currentUserId) ?? null;
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
