import type { MemberMark } from '@/api/chats';
import { memberEventText } from '@/features/chats/memberEventText';

const mark = (patch: Partial<MemberMark>): MemberMark => ({
  event: 'member_left',
  actorId: 'a',
  actorName: 'Аня',
  subjectId: null,
  subjectName: null,
  ...patch,
});

describe('memberEventText', () => {
  it('пишет все пять событий состава', () => {
    expect(
      memberEventText(mark({ event: 'member_invited', subjectId: 'b', subjectName: 'Борис' })),
    ).toBe('Аня пригласил(а) Борис');
    expect(memberEventText(mark({ event: 'member_joined' }))).toBe('Аня вступил(а) в группу');
    expect(memberEventText(mark({ event: 'member_left' }))).toBe('Аня покинул(а) группу');
    expect(
      memberEventText(mark({ event: 'member_removed', subjectId: 'b', subjectName: 'Борис' })),
    ).toBe('Аня удалил(а) Борис');
    expect(
      memberEventText(
        mark({
          event: 'owner_changed',
          actorId: null,
          actorName: null,
          subjectId: 'v',
          subjectName: 'Виктор',
        }),
      ),
    ).toBe('Владельцем стал(а) Виктор');
  });

  it('удалённый аккаунт так и называет', () => {
    expect(memberEventText(mark({ actorId: null, actorName: null }))).toBe(
      'Удалённый аккаунт покинул(а) группу',
    );
  });
});
