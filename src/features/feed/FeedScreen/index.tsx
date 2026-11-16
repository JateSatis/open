import { useCallback } from 'react';

import { Screen } from '@/components/Screen';
import { TabBar } from '@/components/TabBar';
import { Text } from '@/components/Text';
import { FeedSearchPanel } from '@/features/search/FeedSearchPanel';
import { ConnectionBanner } from '@/features/connection/ConnectionBanner';
import { SearchBar } from '@/features/search/SearchBar';
import { feedRecentQueries } from '@/features/search/recentSearches';
import { useSearchMode } from '@/features/search/useSearchMode';
import { Spacing } from '@/theme';

export function FeedScreen() {
  const search = useSearchMode();
  const { query, setQuery } = search;

  // «Поиск» на клавиатуре — запрос в недавние, как и открытие найденного.
  const submit = useCallback(() => {
    const text = query.trim();

    if (text) feedRecentQueries.add(text);
  }, [query]);

  return (
    <Screen
      edges={['top']}
      contentContainerStyle={{ paddingHorizontal: Spacing.three, paddingVertical: 0 }}
      overlay={<TabBar active="feed" />}
    >
      <ConnectionBanner style={{ marginHorizontal: -Spacing.three }} />

      <SearchBar
        value={query}
        onChangeText={setQuery}
        active={search.active}
        onActivate={search.activate}
        onCancel={search.cancel}
        onSubmit={submit}
        testIDPrefix="feed-search"
      />

      {search.active ? (
        <FeedSearchPanel query={query} onPickRecent={setQuery} />
      ) : (
        <Text color="textSecondary" style={{ paddingTop: Spacing.three }}>
          Фрагменты чатов, посты и клипы появятся здесь.
        </Text>
      )}
    </Screen>
  );
}
