import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { MatchSearch } from './useMatchSearch';

import { Text } from '@/components/Text';
import { CHAT_SEARCH_COUNT_CAP } from '@/features/chats/limits';
import { useTheme } from '@/hooks/use-theme';
import { InfoPageSizes, Sizes, Spacing } from '@/theme';

/** «3 из 12», «Ничего не найдено» или пусто, пока запроса нет. */
export function searchCounterText(search: MatchSearch): string {
  if (search.searched === '') return '';
  if (search.hits.length === 0) return search.isSearching ? '' : 'Ничего не найдено';

  const total = search.total ?? search.hits.length;
  const shown = total >= CHAT_SEARCH_COUNT_CAP ? `${CHAT_SEARCH_COUNT_CAP}+` : String(total);

  return `${search.index + 1} из ${shown}`;
}

export type ChatSearchPlateProps = {
  search: MatchSearch;
  showingList: boolean;
  onToggleList: () => void;
};

/** Плашка на месте поля ввода: счётчик совпадений, стрелки и «Списком». */
export function ChatSearchPlate({ search, showingList, onToggleList }: ChatSearchPlateProps) {
  const theme = useTheme();
  const { hits, index, hasMore } = search;
  const canOlder = index + 1 < hits.length || (hits.length > 0 && hasMore);
  const canNewer = index > 0;

  const arrow = (
    direction: 'up' | 'down',
    enabled: boolean,
    onPress: () => void,
    label: string,
  ) => (
    <Pressable
      testID={`chat-search-${direction}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      hitSlop={Spacing.two}
      onPress={onPress}
      style={styles.arrow}
    >
      <SymbolView
        name={
          direction === 'up'
            ? { ios: 'chevron.up', android: 'keyboard_arrow_up', web: 'keyboard_arrow_up' }
            : { ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' }
        }
        size={InfoPageSizes.barIcon}
        tintColor={enabled ? theme.primary : theme.textSecondary}
      />
    </Pressable>
  );

  return (
    <View
      testID="chat-search-plate"
      style={[styles.plate, { borderTopColor: theme.border, backgroundColor: theme.background }]}
    >
      <Pressable
        testID="chat-search-list"
        accessibilityRole="button"
        accessibilityLabel={showingList ? 'К переписке' : 'Списком'}
        // Пустой список закрыть можно всегда: иначе он прятал бы переписку.
        disabled={hits.length === 0 && !showingList}
        hitSlop={Spacing.two}
        onPress={onToggleList}
      >
        <Text color={hits.length === 0 && !showingList ? 'textSecondary' : 'primary'}>
          {showingList ? 'В чате' : 'Списком'}
        </Text>
      </Pressable>
      <View style={styles.counter}>
        {search.isSearching && hits.length === 0 ? (
          <ActivityIndicator size="small" accessibilityLabel="Поиск" />
        ) : (
          <Text testID="chat-search-counter" color="textSecondary" numberOfLines={1}>
            {searchCounterText(search)}
          </Text>
        )}
      </View>
      {arrow('up', canOlder, search.older, 'Раньше')}
      {arrow('down', canNewer, search.newer, 'Позже')}
    </View>
  );
}

const styles = StyleSheet.create({
  plate: {
    minHeight: Sizes.chatSearchPlate,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  counter: {
    flex: 1,
    alignItems: 'center',
  },
  arrow: {
    padding: Spacing.one,
  },
});
