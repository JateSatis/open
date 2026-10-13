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

/** Чтение с телефона, которое завершается, когда скажет тест. */
function pendingRead() {
  let finish: (value: string | null) => void = () => undefined;
  jest
    .mocked(AsyncStorage.getItem)
    .mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));

  return async (value: string | null) => {
    finish(value);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
}

beforeEach(async () => {
  resetRecentSearches();
  jest.clearAllMocks();
  loadRecentSearches('me');
  await new Promise((resolve) => setTimeout(resolve, 0));
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

it('saves to the phone under the account and clears on «Очистить»', () => {
  addRecentSearch(channel('a'));

  const [key, saved] = jest.mocked(AsyncStorage.setItem).mock.calls.at(-1) ?? [];
  expect(key).toContain('me');
  expect(parseRecentSearches(saved ?? null)).toHaveLength(1);

  clearRecentSearches();
  expect(titles()).toEqual([]);
});

it('forgets everything on sign-out, on the phone too', () => {
  addRecentSearch(channel('a'));
  resetRecentSearches();

  expect(titles()).toEqual([]);
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith(expect.stringContaining('me'));
});

it('reads the history of the account that signed in, not of the previous one', async () => {
  const finish = pendingRead();
  loadRecentSearches('other');
  await finish(JSON.stringify([channel('theirs')]));

  expect(AsyncStorage.getItem).toHaveBeenLastCalledWith(expect.stringContaining('other'));
  expect(titles()).toEqual(['Канал theirs']);
});

it('does not bring back the previous account when a read finishes after sign-out', async () => {
  resetRecentSearches();
  const finish = pendingRead();

  loadRecentSearches('old');
  resetRecentSearches();
  await finish(JSON.stringify([channel('old')]));

  expect(titles()).toEqual([]);
});

it('keeps both what was opened during the read and what was stored', async () => {
  resetRecentSearches();
  const finish = pendingRead();

  loadRecentSearches('me');
  addRecentSearch(channel('new'));
  await finish(JSON.stringify([channel('stored')]));

  expect(titles()).toEqual(['Канал new', 'Канал stored']);
});

it('does not bring back what «Очистить» removed while reading', async () => {
  resetRecentSearches();
  const finish = pendingRead();

  loadRecentSearches('me');
  clearRecentSearches();
  await finish(JSON.stringify([channel('stored')]));

  expect(titles()).toEqual([]);
});

it('ignores a broken or foreign file', () => {
  expect(parseRecentSearches('{')).toEqual([]);
  expect(parseRecentSearches(JSON.stringify([{ type: 'stream' }, channel('a')]))).toHaveLength(1);
});
