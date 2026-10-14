import { localChatMatches } from './localChatMatches';
import { parseSearchQuery } from './searchText';

import type { ChatSummary } from '@/api/chats';

const READ_AT = '2026-10-13T09:00:00Z';

function chat(overrides: Partial<ChatSummary>): ChatSummary {
  return {
    id: 'chat',
    kind: 'direct',
    ownerId: null,
    description: null,
    avatarUrl: null,
    title: null,
    username: null,
    channel: null,
    participants: [
      { id: 'me', displayName: 'Я', avatarUrl: null, lastReadAt: READ_AT },
      {
        id: 'anna',
        displayName: 'Анна Ёлкина',
        avatarUrl: 'https://a/anna.png',
        lastReadAt: READ_AT,
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
    ...overrides,
  };
}

const dialog = chat({ id: 'dialog' });
const group = chat({ id: 'group', kind: 'group', title: 'Планы на выходные', username: 'plans' });
const channel = chat({
  id: 'posts',
  kind: 'channel',
  channel: { id: 'ch', title: 'Max news', username: 'news', avatarUrl: null },
});
const person = chat({
  id: 'max-dialog',
  participants: [
    { id: 'me', displayName: 'Я', avatarUrl: null, lastReadAt: READ_AT },
    { id: 'max', displayName: 'Макс', avatarUrl: null, lastReadAt: READ_AT },
  ],
});

function titles(query: string, chats = [dialog, group, channel, person]) {
  return localChatMatches(chats, parseSearchQuery(query), 'me').map((entity) => entity.title);
}

it('finds a dialog by the other side, ignoring case and ё', () => {
  expect(titles('елкина')).toEqual(['Анна Ёлкина']);
  const [entity] = localChatMatches([dialog], parseSearchQuery('анна'), 'me');

  expect(entity).toMatchObject({
    section: 'mine',
    kind: 'direct',
    chatId: 'dialog',
    personId: 'anna',
    avatarUrl: 'https://a/anna.png',
  });
});

it('opens a channel by its channel id', () => {
  const [entity] = localChatMatches([channel], parseSearchQuery('news'), 'me');

  expect(entity).toMatchObject({ kind: 'channel', id: 'ch', chatId: 'posts', channelId: 'ch' });
});

it('draws a group by its own photo', () => {
  const withPhoto = chat({ ...group, avatarUrl: 'https://a/group.png' });
  const [entity] = localChatMatches([withPhoto], parseSearchQuery('планы'), 'me');

  expect(entity).toMatchObject({ kind: 'group', avatarUrl: 'https://a/group.png' });
});

it('finds by username and by title', () => {
  expect(titles('plans')).toEqual(['Планы на выходные']);
  expect(titles('выходн')).toEqual(['Планы на выходные']);
});

it('narrows the kind by suffix', () => {
  expect(titles('news.ch')).toEqual(['Max news']);
  expect(titles('plans.di')).toEqual(['Планы на выходные']);
  expect(titles('news.di')).toEqual([]);
});

it('with @ puts a username match above a title match', () => {
  const maxGroup = chat({ id: 'g2', kind: 'group', title: 'Чат', username: 'max' });

  expect(titles('@max', [channel, maxGroup])).toEqual(['Чат', 'Max news']);
});

it('puts an exact match above a word start above the middle of a word', () => {
  const exact = chat({ id: 'a', kind: 'group', title: 'Квазар' });
  const prefix = chat({ id: 'b', kind: 'group', title: 'Квазары тут' });
  const middle = chat({ id: 'c', kind: 'group', title: 'Мегаквазар' });

  expect(titles('квазар', [middle, prefix, exact])).toEqual([
    'Квазар',
    'Квазары тут',
    'Мегаквазар',
  ]);
});

it('finds nothing for an empty query', () => {
  expect(titles('   ')).toEqual([]);
  expect(titles('@')).toEqual([]);
});
