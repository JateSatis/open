import { chatTitle, counterpart, formatChatTimestamp, isChatMember } from './chatDisplay';

import type { ChatSummary } from '@/api/chats';

const direct: ChatSummary = {
  id: 'chat-1',
  kind: 'direct',
  title: null,
  participants: [
    { id: 'user-1', displayName: 'Я', avatarUrl: null },
    { id: 'user-2', displayName: 'Марина', avatarUrl: 'https://cdn.example/avatar.png' },
  ],
  lastMessagePreview: null,
  lastMessageAt: null,
};

const group: ChatSummary = {
  ...direct,
  id: 'chat-2',
  kind: 'group',
  title: 'Планёрка',
};

describe('chatDisplay', () => {
  it('names a direct chat after the other side', () => {
    expect(chatTitle(direct, 'user-1')).toBe('Марина');
    expect(counterpart(direct, 'user-1')?.id).toBe('user-2');
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
