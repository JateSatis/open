import type { MemberMark } from '@/api/chats';
import { DELETED_ACCOUNT } from '@/features/chats/messageQuote';

/**
 * Строка состава группы. Тот же текст, что пишет база (`member_event_text`),
 * но с нынешними именами. Пола у профиля нет — «покинул(а)», как «был(а)».
 */
export function memberEventText(mark: MemberMark): string {
  const actor = mark.actorName ?? DELETED_ACCOUNT;
  const subject = mark.subjectName ?? DELETED_ACCOUNT;

  switch (mark.event) {
    case 'member_invited':
      return `${actor} пригласил(а) ${subject}`;
    case 'member_joined':
      return `${actor} вступил(а) в группу`;
    case 'member_left':
      return `${actor} покинул(а) группу`;
    case 'member_removed':
      return `${actor} удалил(а) ${subject}`;
    case 'owner_changed':
      return `Владельцем стал(а) ${subject}`;
  }
}
