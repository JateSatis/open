import { useMemo } from 'react';
import { ActivityIndicator, View, useWindowDimensions } from 'react-native';
import Animated, {
  LinearTransition,
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';

import { styles } from './styles';
import { useWatchLaterRows } from './useWatchLaterRows';

import type { ChatSummary } from '@/api/chats';
import type { SavedFilterInput, SavedMessage, SavedTag } from '@/api/saved';
import { mosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { bubbleAsideWidth } from '@/features/chats/MessageBubble/layout';
import { addFilterTag, resetSavedFilters } from '@/features/saved/savedFiltersStore';
import { SavedListState } from '@/features/saved/SavedListState';
import { SavedMenu } from '@/features/saved/SavedMenu';
import { useOpenSavedSource } from '@/features/saved/useOpenSavedSource';
import { useSavedItemActions } from '@/features/saved/useSavedItemActions';
import { useSavedMenu } from '@/features/saved/useSavedMenu';
import { useWatchLater } from '@/features/saved/useWatchLater';
import { WatchLaterRow, WatchLaterRowBody } from '@/features/saved/WatchLaterRow';
import { Sizes, Spacing } from '@/theme';

/** Строки ниже сдвигаются плавно: раскрытие, отметка, свайп. */
const ROW_LAYOUT = LinearTransition.duration(220);

const EMPTY = {
  testID: 'watch-later-empty',
  title: 'Список пуст',
  hint: 'Отметьте «Посмотреть позже» при сохранении или в меню сохранённого сообщения — оно появится здесь.',
};

const NOTHING_FOUND = { testID: 'watch-later-nothing-found', title: 'Ничего не найдено' };

export type SavedWatchLaterTabProps = {
  currentUserId: string | null;
  tags: SavedTag[];
  tagsById: ReadonlyMap<string, SavedTag>;
  /** Вкладка видна: до первого захода список не грузится. */
  active: boolean;
  /** Фильтры экрана и запрос поиска — список сужается до подходящих строк. */
  filter: { input: SavedFilterInput | null; key: string | null };
  /** Выбраны фильтры (без поиска) — в пустом списке «Сбросить фильтры». */
  filtered: boolean;
  /** Запрос поиска после паузы; пусто — поиска нет. Совпадение подсвечено в превью. */
  searched: string;
  /** «Ответить» — на «Все», с плашкой над полем заметок. */
  onReply: (items: SavedMessage[], chats: ReadonlyMap<string, ChatSummary>) => void;
  /** «Изменить» своей заметки — на «Все», с плашкой правки. */
  onEdit: (saved: SavedMessage) => void;
};

/**
 * Вкладка «Посмотреть позже» — список дел: компактные строки, раскрытие на
 * месте, чекбокс, свайп убирает из вкладки (но не из сохранённого).
 */
export function SavedWatchLaterTab({
  currentUserId,
  tags,
  tagsById,
  active,
  filter,
  filtered,
  searched,
  onReply,
  onEdit,
}: SavedWatchLaterTabProps) {
  const { width: windowWidth } = useWindowDimensions();
  const later = useWatchLater(active, filter);
  const openSource = useOpenSavedSource();
  const handlers = useSavedItemActions({
    chats: later.chats,
    currentUserId,
    onReply: (items) => onReply(items, later.chats),
    onEdit,
  });
  const rows = useWatchLaterRows(handlers.actions);
  const {
    frameRef,
    target: menuTarget,
    viewport: menuViewport,
    saved: menuSaved,
    open: openMenu,
    close: closeMenu,
  } = useSavedMenu(later.items, 'later');
  const scrollY = useSharedValue(0);
  const listTop = useSharedValue(0);
  const sticky = useMemo(() => ({ scrollY, listTop }), [listTop, scrollY]);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });
  // Пузырь раскрытой строки — во всю ширину, кроме колонки чекбокса.
  const mediaBounds = useMemo(
    () =>
      mosaicBounds(
        windowWidth - Spacing.three * 2 - Sizes.selectionCheck - Spacing.two,
        false,
        bubbleAsideWidth(true),
      ),
    [windowWidth],
  );

  const rowProps = (saved: SavedMessage) => ({
    saved,
    chats: later.chats,
    currentUserId,
    tagsById,
    mediaBounds,
    expanded: rows.expanded.has(saved.id),
    onOpenSource: openSource,
    searched,
  });

  const renderItem = ({ item }: { item: SavedMessage }) => (
    <WatchLaterRow
      {...rowProps(item)}
      sticky={sticky}
      onToggleExpanded={rows.toggleExpanded}
      onToggleDone={rows.toggleDone}
      onRemove={rows.remove}
      onOpenMenu={openMenu}
      onTagPress={addFilterTag}
    />
  );

  const state = (
    <SavedListState
      failed={later.failed}
      loading={later.isLoading}
      empty={
        later.items.length === 0
          ? filtered
            ? {
                ...NOTHING_FOUND,
                action: {
                  label: 'Сбросить фильтры',
                  onPress: resetSavedFilters,
                  testID: 'watch-later-filter-reset',
                },
              }
            : searched !== ''
              ? NOTHING_FOUND
              : EMPTY
          : null
      }
      onRetry={later.reload}
      failText="Не удалось загрузить список"
      loadingLabel="Загрузка списка"
    />
  );

  if (later.failed || later.isLoading || later.items.length === 0) return state;

  return (
    <View
      ref={frameRef}
      collapsable={false}
      style={styles.flex}
      onLayout={() => frameRef.current?.measureInWindow((_x, y) => listTop.set(y))}
    >
      <Animated.FlatList
        testID="watch-later-list"
        data={later.items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        extraData={rows.expanded}
        itemLayoutAnimation={ROW_LAYOUT}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onEndReached={later.loadMore}
        onEndReachedThreshold={1}
        contentContainerStyle={styles.list}
        ListFooterComponent={
          later.isLoadingMore ? <ActivityIndicator accessibilityLabel="Загрузка" /> : null
        }
      />

      <SavedMenu
        target={menuTarget}
        saved={menuSaved}
        viewport={menuViewport}
        preview={menuSaved ? <WatchLaterRowBody {...rowProps(menuSaved)} /> : null}
        previewGrowth="down"
        tags={tags}
        actions={handlers.actions}
        onAction={handlers.run}
        onClose={closeMenu}
      />
    </View>
  );
}
