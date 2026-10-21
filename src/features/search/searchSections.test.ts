import { buildSearchSections, COLLAPSED_ROWS, type ExpandableSection } from './searchSections';

import type { SearchEntity, SearchMessage } from '@/api/search';

function entity(section: 'mine' | 'global', id: string): SearchEntity {
  return {
    section,
    kind: 'group',
    id,
    chatId: id,
    channelId: null,
    personId: null,
    title: `Группа ${id}`,
    username: null,
    avatarUrl: null,
    subscribed: false,
    subscribersCount: 0,
  };
}

const message: SearchMessage = {
  id: 'm1',
  chatId: 'c1',
  chatKind: 'direct',
  channelId: null,
  chatTitle: 'Аня',
  chatAvatarUrl: null,
  authorId: 'a',
  authorName: 'Аня',
  text: 'привет',
  seq: 1,
  createdAt: '2026-10-13T10:00:00Z',
  fuzzy: false,
};

const none = new Set<ExpandableSection>();

function build(overrides: Partial<Parameters<typeof buildSearchSections>[0]>) {
  return buildSearchSections({
    query: 'гру',
    recent: [],
    mine: [],
    global: [],
    messages: [],
    expanded: none,
    ...overrides,
  });
}

it('shows only the blocks that found something, in a fixed order', () => {
  expect(build({ mine: [entity('mine', 'a')] }).map((section) => section.title)).toEqual(['Чаты']);
  expect(
    build({
      messages: [message],
      global: [entity('global', 'g')],
      mine: [entity('mine', 'a')],
    }).map((section) => section.title),
  ).toEqual(['Чаты', 'Глобальный поиск', 'Сообщения']);
});

it('shows three rows of a long block until it is expanded', () => {
  const many = ['a', 'b', 'c', 'd', 'e'].map((id) => entity('mine', id));
  const [collapsed] = build({ mine: many });

  expect(collapsed.data).toHaveLength(COLLAPSED_ROWS);
  expect(collapsed).toMatchObject({ expandable: true, expanded: false });

  const [open] = build({ mine: many, expanded: new Set(['mine']) });

  expect(open.data).toHaveLength(5);
  expect(open.expanded).toBe(true);
});

it('does not offer «Показать ещё» when everything already fits', () => {
  const [section] = build({ global: [entity('global', 'a'), entity('global', 'b')] });

  expect(section.expandable).toBe(false);
});

it('shows every message found, without collapsing', () => {
  const messages = Array.from({ length: 10 }, (_, index) => ({ ...message, id: `m${index}` }));
  const [section] = build({ messages });

  expect(section.data).toHaveLength(10);
});

it('shows only «Недавние» for an empty query, and nothing when there are none', () => {
  const recent = [{ type: 'message' as const, message }];

  expect(build({ query: ' ', recent, mine: [entity('mine', 'a')] }).map((s) => s.title)).toEqual([
    'Недавние',
  ]);
  expect(build({ query: '' })).toEqual([]);
});
