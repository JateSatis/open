import { ScreenOptions } from '@/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Keyboard, View, useWindowDimensions } from 'react-native';
import { useSharedValue, withTiming } from 'react-native-reanimated';

import { styles } from './styles';

import { SegmentedControl } from '@/components/SegmentedControl';
import { ChatSearchHeader } from '@/features/chats/chatSearch/ChatSearchHeader';
import { MATCH_SEARCH_DEBOUNCE_MS } from '@/features/chats/chatSearch/useMatchSearch';
import { mosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { bubbleAsideWidth } from '@/features/chats/MessageBubble/layout';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { SavedAllTab } from '@/features/saved/SavedAllTab';
import { SavedFilterBar } from '@/features/saved/SavedFilterBar';
import { SavedFilterSheet } from '@/features/saved/SavedFilterSheet';
import { SavedHeaderActions } from '@/features/saved/SavedHeaderActions';
import { filterKey, toFilterInput, type FilterChip } from '@/features/saved/savedFilters';
import {
  resetSavedFilters,
  setFilterDates,
  toggleFilterCategory,
  toggleFilterTag,
  toggleFilterType,
} from '@/features/saved/savedFiltersStore';
import { SavedWatchLaterTab } from '@/features/saved/SavedWatchLaterTab';
import { useSavedComposer } from '@/features/saved/useSavedComposer';
import { useSavedFilterInput } from '@/features/saved/useSavedFilterInput';
import { useSavedTags } from '@/features/saved/useSavedTags';
import { useTheme } from '@/hooks/use-theme';
import { useDebounced } from '@/lib/useDebounced';
import { Motion, Spacing } from '@/theme';

const TABS = ['Все', 'Посмотреть позже'] as const;

function removeChip(chip: FilterChip) {
  if (chip.kind === 'dates') setFilterDates({ from: null, to: null });
  else if (chip.kind === 'type') toggleFilterType(chip.value);
  else if (chip.kind === 'category') toggleFilterCategory(chip.value);
  else toggleFilterTag(chip.tagId);
}

/**
 * «Сохранённые сообщения»: под шапкой — переключатель «Все | Посмотреть
 * позже» и строка активных фильтров. Обе вкладки живут, пока открыт экран,
 * а неактивная лишь невидима: переключение не теряет прокрутку другой.
 * «Посмотреть позже» грузится при первом заходе на неё. Поле заметок — у
 * экрана: «Ответить» и «Изменить» с «Посмотреть позже» переключают на «Все»
 * с плашкой над полем. Фильтры и поиск — общие для вкладок: на «Все» поиск
 * прыгает по совпадениям, на «Посмотреть позже» сужает список. Уход с
 * экрана фильтры сбрасывает.
 */
export function SavedScreen() {
  const theme = useTheme();
  const currentUserId = useCurrentUserId();
  const { width: windowWidth } = useWindowDimensions();
  const { tags } = useSavedTags();
  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const mediaBounds = useMemo(
    () => mosaicBounds(windowWidth - Spacing.three * 2, false, bubbleAsideWidth(true)),
    [windowWidth],
  );
  const [tab, setTab] = useState(0);
  const [laterOpened, setLaterOpened] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const position = useSharedValue(0);
  const notes = useSavedComposer(currentUserId);
  const closeSearch = useCallback(() => {
    Keyboard.dismiss();
    setQuery('');
    setSearchOpen(false);
  }, []);
  // Пока открыт поиск, поле заметок спрятано под плашкой: «Ответить» и
  // «Изменить» закрывают поиск, иначе плашку ответа или правки не видно.
  const { startReply: replyInField, startEdit: editInField } = notes;
  const startReply = useCallback(
    (...args: Parameters<typeof replyInField>) => {
      closeSearch();
      replyInField(...args);
    },
    [closeSearch, replyInField],
  );
  const startEdit = useCallback(
    (...args: Parameters<typeof editInField>) => {
      closeSearch();
      editInField(...args);
    },
    [closeSearch, editInField],
  );
  const composer = { ...notes, startReply, startEdit };
  const filter = useSavedFilterInput();
  // «Посмотреть позже» сужается по тому же запросу, с той же паузой.
  const laterQuery = useDebounced(searchOpen ? query.trim() : '', MATCH_SEARCH_DEBOUNCE_MS);
  const laterFilter = useMemo(() => {
    const input = toFilterInput(filter.filters, laterQuery);

    return { input, key: filterKey(input) };
  }, [filter.filters, laterQuery]);

  useEffect(() => () => resetSavedFilters(), []);

  const select = useCallback(
    (index: number) => {
      setTab(index);
      if (index === 1) setLaterOpened(true);
      position.set(withTiming(index, { duration: Motion.segmentMs }));
    },
    [position],
  );
  const replyFromLater = useCallback(
    (...args: Parameters<typeof startReply>) => {
      select(0);
      startReply(...args);
    },
    [select, startReply],
  );
  const editFromLater = useCallback(
    (...args: Parameters<typeof startEdit>) => {
      select(0);
      startEdit(...args);
    },
    [select, startEdit],
  );
  const headerRight = useCallback(
    () => (
      <SavedHeaderActions
        filtered={filter.active}
        onSearch={() => setSearchOpen(true)}
        onFilters={() => setFiltersOpen(true)}
      />
    ),
    [filter.active],
  );

  const shared = { currentUserId, tags, tagsById };

  return (
    <View testID="saved-screen" style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScreenOptions options={{ headerShown: !searchOpen }} />
      {searchOpen ? (
        <ChatSearchHeader
          search={{ query, setQuery }}
          onClose={closeSearch}
          placeholder="Поиск в сохранённом"
        />
      ) : null}

      <View style={styles.tabs}>
        <SegmentedControl
          segments={TABS}
          position={position}
          selectedIndex={tab}
          onSelect={select}
        />
      </View>

      <SavedFilterBar
        filters={filter.filters}
        tagsById={tagsById}
        onRemove={removeChip}
        onReset={resetSavedFilters}
      />

      <View style={styles.pages}>
        <View
          testID="saved-tab-all"
          pointerEvents={tab === 0 ? 'auto' : 'none'}
          importantForAccessibility={tab === 0 ? 'auto' : 'no-hide-descendants'}
          accessibilityElementsHidden={tab !== 0}
          style={[styles.page, tab !== 0 && styles.hidden]}
        >
          <SavedAllTab
            {...shared}
            mediaBounds={mediaBounds}
            active={tab === 0}
            composer={composer}
            filter={filter}
            search={searchOpen ? query : null}
            headerRight={headerRight}
          />
        </View>

        {laterOpened ? (
          <View
            testID="saved-tab-later"
            pointerEvents={tab === 1 ? 'auto' : 'none'}
            importantForAccessibility={tab === 1 ? 'auto' : 'no-hide-descendants'}
            accessibilityElementsHidden={tab !== 1}
            style={[styles.page, tab !== 1 && styles.hidden]}
          >
            <SavedWatchLaterTab
              {...shared}
              active={tab === 1}
              filter={laterFilter}
              filtered={filter.active}
              searched={laterQuery}
              onReply={replyFromLater}
              onEdit={editFromLater}
            />
          </View>
        ) : null}
      </View>

      {filtersOpen ? <SavedFilterSheet tags={tags} onClose={() => setFiltersOpen(false)} /> : null}
    </View>
  );
}
