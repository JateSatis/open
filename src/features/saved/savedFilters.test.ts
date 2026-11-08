import { QueryClient, type InfiniteData } from '@tanstack/react-query';

import type { SavedMessage, SavedPage, SavedPin, WatchLaterPage } from '@/api/saved';
import {
  savedMessagesKey,
  savedMessagesQueryKey,
  savedPinsKey,
  savedSummaryQueryKey,
  savedWatchLaterKey,
} from '@/features/saved/keys';
import { patchSaved, putInWatchLater, refreshFiltered } from '@/features/saved/savedCache';
import {
  NO_FILTERS,
  dateChipLabel,
  filterChips,
  filterKey,
  hasFilters,
  toFilterInput,
} from '@/features/saved/savedFilters';
import {
  addFilterTag,
  getSavedFilters,
  resetSavedFilters,
  toggleFilterTag,
} from '@/features/saved/savedFiltersStore';

jest.mock('@/api/supabase', () => ({ supabase: {} }));

const NOW = new Date(2026, 9, 25, 12);

function saved(id: string, seq: number, overrides: Partial<SavedMessage> = {}): SavedMessage {
  return {
    id,
    seq,
    savedAt: '2026-10-20T10:00:00Z',
    sourceType: 'message',
    category: 'member',
    sourceChatId: 'chat-g',
    sourceMessageId: `msg-${id}`,
    sourceCommentId: null,
    kind: 'text',
    text: `текст ${id}`,
    authorId: null,
    authorName: null,
    authorAvatarUrl: null,
    authorOpaque: false,
    originalAt: null,
    watchLaterAt: null,
    watchDoneAt: null,
    pinnedAt: null,
    attachments: [],
    tagIds: [],
    edited: false,
    replies: [],
    ...overrides,
  };
}

describe('dateChipLabel', () => {
  it('names a whole month, with the year only when it is not this one', () => {
    expect(dateChipLabel('2026-08-01', '2026-08-31', NOW)).toBe('Август');
    expect(dateChipLabel('2025-08-01', '2025-08-31', NOW)).toBe('Август 2025');
    expect(dateChipLabel('2026-02-01', '2026-02-28', NOW)).toBe('Февраль');
  });

  it('shows one day, a range and open ends', () => {
    expect(dateChipLabel('2026-11-06', '2026-11-06', NOW)).toBe('06.11');
    expect(dateChipLabel('2026-08-01', '2026-08-15', NOW)).toBe('01.08–15.08');
    expect(dateChipLabel('2026-08-01', '2026-08-30', NOW)).toBe('01.08–30.08');
    expect(dateChipLabel('2026-08-01', null, NOW)).toBe('с 01.08');
    expect(dateChipLabel(null, '2026-08-15', NOW)).toBe('до 15.08');
    expect(dateChipLabel(null, null, NOW)).toBeNull();
  });
});

describe('toFilterInput', () => {
  it('sends nothing without filters and search', () => {
    expect(toFilterInput(NO_FILTERS)).toBeNull();
    expect(toFilterInput(NO_FILTERS, '   ')).toBeNull();
    expect(hasFilters(NO_FILTERS)).toBe(false);
  });

  it('turns days into local-day moments, «до» inclusive', () => {
    const input = toFilterInput({ ...NO_FILTERS, from: '2026-08-01', to: '2026-08-31' });

    expect(input?.from).toBe(new Date(2026, 7, 1).toISOString());
    expect(input?.to).toBe(new Date(2026, 8, 1).toISOString());
  });

  it('gives the same key to the same choice in any order, search on top', () => {
    const a = toFilterInput({ ...NO_FILTERS, tags: ['t2', 't1'], categories: ['note', 'channel'] });
    const b = toFilterInput({ ...NO_FILTERS, tags: ['t1', 't2'], categories: ['channel', 'note'] });

    expect(filterKey(a)).toBe(filterKey(b));
    expect(toFilterInput({ ...NO_FILTERS, types: ['voice'] }, ' ёжик ')).toEqual({
      types: ['voice'],
      q: 'ёжик',
    });
  });
});

describe('filterChips', () => {
  it('lists dates, types, sources and tags in that order', () => {
    const chips = filterChips(
      {
        tags: ['work'],
        categories: ['channel'],
        types: ['voice'],
        from: '2026-08-01',
        to: '2026-08-31',
      },
      NOW,
    );

    expect(chips.map((chip) => (chip.kind === 'tag' ? chip.tagId : chip.label))).toEqual([
      'Август',
      'Голосовое',
      'Каналы',
      'work',
    ]);
  });
});

describe('savedFiltersStore', () => {
  afterEach(resetSavedFilters);

  it('a tag tapped on a bubble is added once', () => {
    addFilterTag('work');
    addFilterTag('work');
    toggleFilterTag('ideas');

    expect(getSavedFilters().tags).toEqual(['work', 'ideas']);

    resetSavedFilters();

    expect(hasFilters(getSavedFilters())).toBe(false);
  });
});

describe('patchSaved under filters', () => {
  const workKey = filterKey({ tags: ['work'] });
  const laterTimes = { watchLaterAt: '2026-10-21T00:00:00Z' };

  function client() {
    const queryClient = new QueryClient();
    const page = (items: SavedMessage[]): InfiniteData<SavedPage> => ({
      pages: [{ items, nextCursor: null }],
      pageParams: [null],
    });
    const later = (items: SavedMessage[]): InfiniteData<WatchLaterPage> => ({
      pages: [{ items, nextCursor: null }],
      pageParams: [null],
    });
    const a = saved('a', 2, { tagIds: ['work'], pinnedAt: '2026-10-21T00:00:00Z', ...laterTimes });
    const b = saved('b', 1);

    queryClient.setQueryData(savedMessagesQueryKey, page([a, b]));
    queryClient.setQueryData(savedMessagesKey(workKey), page([a]));
    queryClient.setQueryData(savedWatchLaterKey(null), later([a]));
    queryClient.setQueryData(savedWatchLaterKey(workKey), later([a]));
    queryClient.setQueryData<SavedPin[]>(savedPinsKey(workKey), [
      { id: 'a', seq: 2, kind: 'text', text: 'текст a', thumbnailUrl: null },
    ]);
    queryClient.setQueryData(savedSummaryQueryKey, { watchLaterPending: 1 });

    return queryClient;
  }

  const ids = (queryClient: QueryClient, key: readonly unknown[]) =>
    queryClient
      .getQueryData<InfiniteData<{ items: SavedMessage[] }>>(key)
      ?.pages.flatMap((page) => page.items.map((item) => item.id));

  it('a record whose tag was removed leaves the filtered lists, not the plain ones', () => {
    const queryClient = client();

    patchSaved(queryClient, ['a'], (item) => ({ ...item, tagIds: [] }));

    expect(ids(queryClient, savedMessagesQueryKey)).toEqual(['a', 'b']);
    expect(ids(queryClient, savedMessagesKey(workKey))).toEqual([]);
    expect(ids(queryClient, savedWatchLaterKey(null))).toEqual(['a']);
    expect(ids(queryClient, savedWatchLaterKey(workKey))).toEqual([]);
    expect(queryClient.getQueryData<SavedPin[]>(savedPinsKey(workKey))).toEqual([]);
    // Счётчик в «Чатах» фильтры не трогают.
    expect(queryClient.getQueryData(savedSummaryQueryKey)).toEqual({ watchLaterPending: 1 });
  });

  it('a record new to a filtered list waits for the server, the plain list takes it at once', () => {
    const queryClient = client();
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');

    patchSaved(queryClient, ['b'], (item) => ({ ...item, ...laterTimes }));
    putInWatchLater(queryClient, saved('c', 3, laterTimes));

    expect(ids(queryClient, savedWatchLaterKey(null))).toEqual(['c', 'b', 'a']);
    expect(ids(queryClient, savedWatchLaterKey(workKey))).toEqual(['a']);
    // Раньше ответа сервера перечитывание отдало бы прежнее состояние.
    expect(invalidate).not.toHaveBeenCalled();

    refreshFiltered(queryClient);

    const refreshed = invalidate.mock.calls.flatMap(([filters]) =>
      queryClient
        .getQueryCache()
        .findAll(filters)
        .map((query) => JSON.stringify(query.queryKey)),
    );

    expect(refreshed).toEqual(
      expect.arrayContaining([
        JSON.stringify(savedMessagesKey(workKey)),
        JSON.stringify(savedWatchLaterKey(workKey)),
        JSON.stringify(savedPinsKey(workKey)),
      ]),
    );
    expect(refreshed).not.toContain(JSON.stringify(savedWatchLaterKey(null)));
  });
});
