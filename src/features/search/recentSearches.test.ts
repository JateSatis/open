import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  RECENT_SEARCHES_LIMIT,
  addRecentSearch,
  clearRecentSearches,
  loadRecentSearches,
  parseRecentSearches,
  resetRecentSearches,
  useRecentSearches,
  type RecentSearch,
} from './recentSearches';

import type { SearchEntity } from '@/api/search';

function channel(id: string): RecentSearch {
  const entity: SearchEntity = {
    section: 'global',
    kind: 'channel',
    id,
    chatId: `posts-${id}`,
    channelId: id,
    personId: null,
    title: `Канал ${id}`,
    username: id,
    avatarUrl: null,
    subscribed: false,
    subscribersCount: 0,
  };

  return { type: 'entity', entity };
}

const titles = () =>
  useRecentSearches
    .getState()
    .items.map((item) => (item.type === 'entity' ? item.entity.title : item.message.id));

beforeEach(() => {
  resetRecentSearches();
  jest.clearAllMocks();
});

it('puts what was opened on top, and a repeat moves up instead of doubling', () => {
  addRecentSearch(channel('a'));
  addRecentSearch(channel('b'));
  addRecentSearch(channel('a'));

  expect(titles()).toEqual(['Канал a', 'Канал b']);
});

it('keeps only the latest few', () => {
  for (let index = 0; index < RECENT_SEARCHES_LIMIT + 5; index += 1) {
    addRecentSearch(channel(String(index)));
  }

  expect(titles()).toHaveLength(RECENT_SEARCHES_LIMIT);
  expect(titles()[0]).toBe(`Канал ${RECENT_SEARCHES_LIMIT + 4}`);
});

it('saves to the phone and clears on «Очистить»', () => {
  addRecentSearch(channel('a'));

  const saved = jest.mocked(AsyncStorage.setItem).mock.calls.at(-1)?.[1] ?? null;
  expect(parseRecentSearches(saved)).toHaveLength(1);

  clearRecentSearches();
  expect(titles()).toEqual([]);
});

it('forgets everything on sign-out, on the phone too', () => {
  addRecentSearch(channel('a'));
  resetRecentSearches();

  expect(titles()).toEqual([]);
  expect(AsyncStorage.removeItem).toHaveBeenCalled();
});

it('does not bring back the previous account when a read finishes after sign-out', async () => {
  useRecentSearches.setState({ items: [], loaded: false });
  let finishRead: (value: string | null) => void = () => undefined;
  jest
    .mocked(AsyncStorage.getItem)
    .mockReturnValueOnce(new Promise((resolve) => (finishRead = resolve)));

  loadRecentSearches();
  resetRecentSearches();
  finishRead(JSON.stringify([channel('old')]));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(titles()).toEqual([]);
});

it('ignores a broken or foreign file', () => {
  expect(parseRecentSearches('{')).toEqual([]);
  expect(parseRecentSearches(JSON.stringify([{ type: 'stream' }, channel('a')]))).toHaveLength(1);
});
