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
    index: 0,
    total: 12,
    isSearching: false,
    failed: false,
    hasMore: true,
    loadMore: jest.fn(),
    older: jest.fn(),
    newer: jest.fn(),
    select: jest.fn(),
    close: jest.fn(),
    ...patch,
  };
}

describe('searchCounterText', () => {
  it('counts from the freshest match against the total', () => {
    expect(searchCounterText(search())).toBe('1 из 12');
    expect(searchCounterText(search({ index: 2 }))).toBe('3 из 12');
  });

  it('says nothing was found, and stays empty while there is no query', () => {
    expect(searchCounterText(search({ hits: [], total: 0 }))).toBe('Ничего не найдено');
    expect(searchCounterText(search({ searched: '', hits: [] }))).toBe('');
  });

  it('caps a huge total', () => {
    expect(searchCounterText(search({ total: 1000 }))).toBe('1 из 1000+');
  });
});

describe('ChatSearchPlate', () => {
  it('goes older with the up arrow and newer with the down arrow', async () => {
    const value = search({ index: 1 });
    await render(<ChatSearchPlate search={value} showingList={false} onToggleList={jest.fn()} />);

    await fireEvent.press(screen.getByTestId('chat-search-up'));
    await fireEvent.press(screen.getByTestId('chat-search-down'));

    expect(value.older).toHaveBeenCalled();
    expect(value.newer).toHaveBeenCalled();
  });

  it('has no newer match at the freshest one', async () => {
    await render(<ChatSearchPlate search={search()} showingList={false} onToggleList={jest.fn()} />);

    expect(screen.getByTestId('chat-search-down')).toBeDisabled();
    expect(screen.getByTestId('chat-search-up')).toBeEnabled();
  });
});
