import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { styles } from './styles';

import type { ChatSummary } from '@/api/chats';
import type { SavedMessage } from '@/api/saved';
import { Text } from '@/components/Text';
import type { MatchSearch } from '@/features/chats/chatSearch/useMatchSearch';
import { formatChatTimestamp } from '@/features/chats/chatDisplay';
import { savedSourceLabel } from '@/features/saved/savedCopy';
import { savedSearchText } from '@/features/saved/savedSearchText';
import { HighlightedText } from '@/features/search/HighlightedText';
import { findMatches, normalizeSearch, snippetAround } from '@/features/search/searchText';
import { useTheme } from '@/hooks/use-theme';


export type SavedSearchResultsProps = {
  search: MatchSearch<SavedMessage>;
  chats: ReadonlyMap<string, ChatSummary>;
  currentUserId: string | null;
  /** Тап по строке: к записи на «Все». */
  onSelect: (index: number) => void;
};

/**
 * Найденное в «Сохранённых» списком поверх «Все»: источник (у заметки —
 * «Вы»), дата сохранения, фрагмент с подсвеченным совпадением. Свежие
 * сверху, дальше — догрузкой.
 */
export function SavedSearchResults({
  search,
  chats,
  currentUserId,
  onSelect,
}: SavedSearchResultsProps) {
  const theme = useTheme();
  const needle = normalizeSearch(search.searched);

  return (
    <View
      testID="saved-search-results"
      style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }]}
    >
      <FlatList
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        data={search.hits}
        keyExtractor={(hit) => hit.id}
        keyboardShouldPersistTaps="handled"
        onEndReached={search.loadMore}
        onEndReachedThreshold={0.5}
        renderItem={({ item, index }) => {
          const chat = item.sourceChatId ? chats.get(item.sourceChatId) : undefined;
          const text = savedSearchText(item, needle);
          const snippet = snippetAround(text, findMatches(text, needle));

          return (
            <Pressable
              testID="saved-search-result"
              accessibilityRole="button"
              accessibilityLabel={text}
              onPress={() => onSelect(index)}
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: theme.backgroundSelected },
              ]}
            >
              <View style={styles.header}>
                <Text variant="bodyBold" numberOfLines={1} style={styles.source}>
                  {savedSourceLabel(item, chat, currentUserId).source}
                </Text>
                <Text variant="caption" color="textSecondary">
                  {formatChatTimestamp(item.savedAt)}
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
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text color="textSecondary">{search.isSearching ? 'Ищем…' : 'Ничего не найдено'}</Text>
          </View>
        }
      />
    </View>
  );
}
