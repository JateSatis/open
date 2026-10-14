import {
  activityLabel,
  chatAvatarUrl,
  chatTitle,
  counterpart,
  dialogPair,
  formatChatTimestamp,
  isChatMember,
} from './chatDisplay';

import type { ChatSummary } from '@/api/chats';

const direct: ChatSummary = {
  id: 'chat-1',
  kind: 'direct',
  ownerId: null,
  description: null,
  avatarUrl: null,
  title: null,
  participants: [
    { id: 'user-1', displayName: 'Я', avatarUrl: null, lastReadAt: '2026-09-16T10:00:00Z' },
    {
      id: 'user-2',
      displayName: 'Марина',
      avatarUrl: 'https://cdn.example/avatar.png',
      lastReadAt: '2026-09-16T10:00:00Z',
    },
  ],
  waiting: [],
  lastMessagePreview: null,
  lastMessageAt: null,
  lastMessageAuthorId: null,
  lastPopAt: null,
  lastActivityAt: null,
  previewIsPop: false,
  subscription: null,
  hasUnread: false,
  subscribersCount: 0,
  username: null,
  channel: null,
};

const group: ChatSummary = {
  ...direct,
  id: 'chat-2',
  kind: 'group',
  title: 'Планёрка',
};

const channelPosts: ChatSummary = {
  ...direct,
  id: 'chat-3',
  kind: 'channel',
  participants: [direct.participants[1]],
  channel: { id: 'ch-1', title: 'Новости', username: 'news', avatarUrl: 'https://cdn/ch.jpg' },
};

describe('chatDisplay', () => {
  it('names a posts chat and draws its avatar after the channel, not the people in it', () => {
    expect(chatTitle(channelPosts, 'user-1')).toBe('Новости');
    expect(chatAvatarUrl(channelPosts, 'user-1')).toBe('https://cdn/ch.jpg');
  });

  it('draws a group by its own photo, and a group without one by nobody', () => {
    const group: ChatSummary = {
      ...direct,
      kind: 'group',
      title: 'Друзья',
      avatarUrl: 'https://cdn/g.jpg',
    };

    expect(chatAvatarUrl(group, 'user-1')).toBe('https://cdn/g.jpg');
    expect(chatAvatarUrl({ ...group, avatarUrl: null }, 'user-1')).toBeNull();
  });

  it('names a direct chat after the other side', () => {
    expect(chatTitle(direct, 'user-1')).toBe('Марина');
    expect(counterpart(direct, 'user-1')?.id).toBe('user-2');
  });

  it("names someone else's dialogue after both people for an outsider", () => {
    const theirs: ChatSummary = {
      ...direct,
      participants: [
        { ...direct.participants[1], displayName: 'Аня' },
        { id: 'user-3', displayName: 'Пётр', avatarUrl: null, lastReadAt: '2026-09-16T10:00:00Z' },
      ],
    };

    expect(chatTitle(theirs, 'user-9')).toBe('Аня и Пётр');
    expect(dialogPair(theirs, 'user-9')?.map((person) => person.id)).toEqual(['user-2', 'user-3']);
    expect(counterpart(theirs, 'user-9')).toBeNull();
    // Хозяин видит свой диалог по собеседнику, как раньше.
    expect(chatTitle(theirs, 'user-2')).toBe('Пётр');
    expect(dialogPair(theirs, 'user-2')).toBeNull();
  });

  it('keeps an invited person on the inside of the dialogue', () => {
    const pending: ChatSummary = {
      ...direct,
      participants: [direct.participants[1]],
      waiting: [{ id: 'user-1', displayName: 'Я', avatarUrl: null }],
    };

    expect(chatTitle(pending, 'user-1')).toBe('Марина');
    expect(chatTitle(pending, 'user-9')).toBe('Марина и Я');
  });

  it('keeps a group named by its title for an outsider too', () => {
    expect(chatTitle(group, 'user-9')).toBe('Планёрка');
    expect(dialogPair(group, 'user-9')).toBeNull();
  });

  it('keeps the group title and has no single counterpart', () => {
    expect(chatTitle(group, 'user-1')).toBe('Планёрка');
    expect(counterpart(group, 'user-1')).toBeNull();
  });

  it('treats an outsider as a non-member, including a signed-out reader', () => {
    expect(isChatMember(direct, 'user-1')).toBe(true);
    expect(isChatMember(direct, 'user-9')).toBe(false);
    expect(isChatMember(direct, null)).toBe(false);
  });

  it('shows time today, a weekday this week and a date beyond it', () => {
    const now = new Date(2026, 8, 16, 18, 0);

    expect(formatChatTimestamp(new Date(2026, 8, 16, 9, 5).toISOString(), now)).toBe('09:05');
    expect(formatChatTimestamp(new Date(2026, 8, 14, 9, 5).toISOString(), now)).toBe('пн');
    expect(formatChatTimestamp(new Date(2026, 7, 3, 9, 5).toISOString(), now)).toBe('03.08');
    expect(formatChatTimestamp(null, now)).toBe('');
  });
});

describe('activityLabel', () => {
  const nameOf = (id: string) => (id === 'u1' ? 'Аня' : 'Борис');

  it('is empty when nobody is doing anything', () => {
    expect(activityLabel([], nameOf)).toBeNull();
  });

  it('tells typing from recording a voice message', () => {
    expect(activityLabel([{ userId: 'u1', activity: 'typing' }], nameOf)).toBe('Аня печатает…');
    expect(activityLabel([{ userId: 'u1', activity: 'recording_voice' }], nameOf)).toBe(
      'Аня записывает голосовое…',
    );
  });

  it('speaks of several people at once', () => {
    expect(
      activityLabel(
        [
          { userId: 'u1', activity: 'recording_voice' },
          { userId: 'u2', activity: 'recording_voice' },
        ],
        nameOf,
      ),
    ).toBe('Несколько человек записывают голосовые…');
    expect(
      activityLabel(
        [
          { userId: 'u1', activity: 'recording_voice' },
          { userId: 'u2', activity: 'typing' },
        ],
        nameOf,
      ),
    ).toBe('Несколько человек печатают…');
  });
});
