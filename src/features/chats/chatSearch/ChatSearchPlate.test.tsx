import { fireEvent, render, screen } from '@testing-library/react-native';

import { ChatSearchPlate, searchCounterText } from './ChatSearchPlate';
import type { ChatSearch } from './useChatSearch';

const hit = (id: string) => ({
  id,
  authorId: 'a',
  authorName: 'Аня',
  text: `про zebra ${id}`,
  seq: Number(id),
  createdAt: '2026-10-14T10:00:00Z',
});

function search(patch: Partial<ChatSearch> = {}): ChatSearch {
  return {
    active: true,
    query: 'zebra',
    setQuery: jest.fn(),
    searched: 'zebra',
    hits: [hit('1'), hit('2'), hit('3')],
    total: 12,
    isSearching: false,
    failed: false,
    hasMore: true,
    loadMore: jest.fn(),
    close: jest.fn(),
    ...patch,
  };
}

describe('searchCounterText', () => {
  it('shows the total number of matches', () => {
    expect(searchCounterText(search())).toBe('Найдено: 12');
  });

  it('says nothing was found, and stays empty while there is no query', () => {
    expect(searchCounterText(search({ hits: [], total: 0 }))).toBe('Ничего не найдено');
    expect(searchCounterText(search({ searched: '', hits: [] }))).toBe('');
  });

  it('caps a huge total', () => {
    expect(searchCounterText(search({ total: 1000 }))).toBe('Найдено: 1000+');
  });
});

describe('ChatSearchPlate', () => {
  it('offers the result list without navigation arrows', async () => {
    const toggle = jest.fn();
    await render(<ChatSearchPlate search={search()} showingList={false} onToggleList={toggle} />);
    expect(screen.queryByTestId('chat-search-up')).toBeNull();
    expect(screen.queryByTestId('chat-search-down')).toBeNull();
    await fireEvent.press(screen.getByTestId('chat-search-list'));
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});
