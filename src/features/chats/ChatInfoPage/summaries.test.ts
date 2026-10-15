import { orderMembers } from './MembersTab';
import { groupsSummary, mediaSummary, membersSummary, voicesSummary } from './summaries';

jest.mock('@/components/InfoPage', () => ({}));

describe('summaries', () => {
  it('lists only what there is', () => {
    expect(mediaSummary(58, 8)).toBe('58 фото, 8 видео');
    expect(mediaSummary(3, 0)).toBe('3 фото');
    expect(mediaSummary(0, 1)).toBe('1 видео');
    expect(voicesSummary(12)).toBe('12 голосовых');
    expect(voicesSummary(1)).toBe('1 голосовое');
    expect(membersSummary(7)).toBe('7 участников');
    expect(groupsSummary(3)).toBe('3 общие группы');
    expect(groupsSummary(1)).toBe('1 общая группа');
  });
});

describe('orderMembers', () => {
  const person = (id: string) => ({ id, displayName: id, avatarUrl: null, lastReadAt: '' });

  it('puts me first, then those online, then the rest in joining order', () => {
    const ordered = orderMembers(
      [person('a'), person('b'), person('me'), person('c'), person('d')],
      'me',
      new Set(['c', 'me']),
    );

    expect(ordered.map((member) => member.id)).toEqual(['me', 'c', 'a', 'b', 'd']);
  });
});
