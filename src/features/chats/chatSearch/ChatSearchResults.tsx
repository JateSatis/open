import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import type { ChatSearch } from './useChatSearch';

import type { ChatSearchHit } from '@/api/search';
import { Text } from '@/components/Text';
import { formatChatTimestamp } from '@/features/chats/chatDisplay';
import { DELETED_ACCOUNT } from '@/features/chats/messageQuote';
import { HighlightedText } from '@/features/search/HighlightedText';
import { findMatches, normalizeSearch, snippetAround } from '@/features/search/searchText';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/theme';

export type ChatSearchResultsProps = {
  search: ChatSearch;
  /** Тап по строке: к сообщению в переписке. */
  onSelect: (index: number) => void;
};

/**
 * Найденные сообщения списком поверх переписки: автор, дата, фрагмент с
 * подсвеченным совпадением. Свежие сверху, дальше — догрузкой.
 */
export function ChatSearchResults({ search, onSelect }: ChatSearchResultsProps) {
  const theme = useTheme();
  const needle = normalizeSearch(search.searched);

  return (
    <View
      testID="chat-search-results"
      style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }]}
    >
      <FlatList
        data={search.hits}
        keyExtractor={(hit) => hit.id}
        keyboardShouldPersistTaps="handled"
        onEndReached={search.loadMore}
        onEndReachedThreshold={0.5}
        renderItem={({ item, index }) => (
          <ResultRow hit={item} needle={needle} onPress={() => onSelect(index)} />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text color="textSecondary">{search.isSearching ? 'Ищем…' : 'Ничего не найдено'}</Text>
          </View>
        }
      />
    </View>
  );
}

function ResultRow({
  hit,
  needle,
  onPress,
}: {
  hit: ChatSearchHit;
  needle: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const snippet = snippetAround(hit.text, findMatches(hit.text, needle));

  return (
    <Pressable
      testID="chat-search-result"
      accessibilityRole="button"
      accessibilityLabel={hit.text}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: theme.backgroundSelected },
      ]}
    >
      <View style={styles.header}>
        <Text variant="bodyBold" numberOfLines={1} style={styles.author}>
          {hit.authorName ?? DELETED_ACCOUNT}
        </Text>
        <Text variant="caption" color="textSecondary">
          {formatChatTimestamp(hit.createdAt)}
        </Text>
      </View>
      <HighlightedText
        variant="small"
        color="textSecondary"
        numberOfLines={2}
        ranges={snippet.ranges}
      >
        {snippet.text}
      </HighlightedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.half,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  author: {
    flex: 1,
  },
  empty: {
    alignItems: 'center',
    padding: Spacing.four,
  },
});
