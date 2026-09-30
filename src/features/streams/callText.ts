import type { CallMark, ChatKind } from '@/api/chats';

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;

  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;

  return many;
}

/** «12 мин» — та же запись, что у `call_duration_text` в базе. */
export function formatCallDuration(startedAt: string, endedAt: string): string {
  const seconds = Math.max(0, Math.floor((Date.parse(endedAt) - Date.parse(startedAt)) / 1000));

  if (seconds < 60) return `${seconds} с`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин`;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return minutes === 0 ? `${hours} ч` : `${hours} ч ${minutes} мин`;
}

/** Таймер на экране звонка: 0:07, 12:40, 1:02:05. */
export function formatCallTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

export function listenersLabel(n: number): string {
  return `${n} ${plural(n, 'слушает', 'слушают', 'слушают')}`;
}

/** «В эфире · слушают 12» — отметка публичности у говорящих, видна всегда, и при нуле. */
export function onAirLabel(listeners: number): string {
  return `В эфире · ${plural(listeners, 'слушает', 'слушают', 'слушают')} ${listeners}`;
}

/** «Идёт звонок · 3 в звонке · 12 слушают». Слушателей нет — о них ни слова. */
export function callBarLabel(speakers: number, listeners: number): string {
  const parts = ['Идёт звонок'];

  if (speakers > 0) parts.push(`${speakers} в звонке`);
  if (listeners > 0) parts.push(listenersLabel(listeners));

  return parts.join(' · ');
}

/** Кто звонит — как назвать входящий: группа по названию, личный диалог по человеку. */
export function incomingTitle(call: {
  chatKind: ChatKind;
  chatTitle: string | null;
  hostName: string;
}): string {
  return call.chatKind === 'group' && call.chatTitle ? call.chatTitle : call.hostName;
}

/** Участник чата, так и не вошедший в завершённый звонок. Посетителю звонок не звонил. */
export function isMissedCall(
  mark: CallMark,
  viewer: { id: string | null; isMember: boolean },
): boolean {
  return (
    mark.event === 'call_ended' && viewer.isMember && !mark.joinedByMe && mark.hostId !== viewer.id
  );
}

/**
 * Текст системного сообщения о звонке. Пропущенный — только для участника
 * чата, который так и не вошёл: посетителю звонок не звонил.
 */
export function callMarkText(
  mark: CallMark,
  viewer: { id: string | null; isMember: boolean },
  hostName: string,
): string {
  if (mark.event === 'call_started') {
    return mark.hostId && mark.hostId === viewer.id
      ? 'Вы начали звонок'
      : `Звонок начат · ${hostName}`;
  }

  if (isMissedCall(mark, viewer)) return 'Пропущенный звонок';

  return mark.endedAt
    ? `Звонок завершён · ${formatCallDuration(mark.startedAt, mark.endedAt)}`
    : 'Звонок завершён';
}
