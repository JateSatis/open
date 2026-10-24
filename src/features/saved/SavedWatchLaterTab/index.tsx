import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View, useWindowDimensions } from 'react-native';
import Animated, {
  LinearTransition,
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';

import { styles } from './styles';

import type { SavedMessage, SavedTag } from '@/api/saved';
import { LoadFailed } from '@/components/LoadFailed';
import { Text } from '@/components/Text';
import { mosaicBounds } from '@/features/chats/lib/mosaicLayout';
import { bubbleAsideWidth } from '@/features/chats/MessageBubble/layout';
import type { AnchorRect, MenuAnchor } from '@/features/chats/MessageContextMenu';
import { showNotice } from '@/features/notifications/alertsStore';
import { SavedMenu, type SavedMenuTarget } from '@/features/saved/SavedMenu';
import { useOpenSavedSource } from '@/features/saved/useOpenSavedSource';
import { useSavedItemActions } from '@/features/saved/useSavedItemActions';
import { useWatchLater } from '@/features/saved/useWatchLater';
import { WatchLaterRow, WatchLaterRowBody } from '@/features/saved/WatchLaterRow';
import { Sizes, Spacing } from '@/theme';

/** Строки ниже сдвигаются плавно: раскрытие, отметка, свайп. */
const ROW_LAYOUT = LinearTransition.duration(220);

export type SavedWatchLaterTabProps = {
  currentUserId: string | null;
  tags: SavedTag[];
  tagsById: ReadonlyMap<string, SavedTag>;
  /** Вкладка видна: до первого захода список не грузится. */
  active: boolean;
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
}: SavedWatchLaterTabProps) {
  const { width: windowWidth } = useWindowDimensions();
  const later = useWatchLater(active);
  const openSource = useOpenSavedSource();
  const handlers = useSavedItemActions({ chats: later.chats, currentUserId });
  const { setWatchLater, restoreWatchLater } = handlers.actions;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [menu, setMenu] = useState<SavedMenuTarget | null>(null);
  const [viewport, setViewport] = useState<AnchorRect | null>(null);
  const frameRef = useRef<View | null>(null);
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
  const menuSaved = useMemo(
    () => (menu ? (later.items.find((item) => item.id === menu.savedId) ?? null) : null),
    [later.items, menu],
  );

  const toggleExpanded = useCallback(
    (saved: SavedMessage) =>
      setExpanded((current) => {
        const next = new Set(current);

        if (next.has(saved.id)) next.delete(saved.id);
        else next.add(saved.id);

        return next;
      }),
    [],
  );
  const toggleDone = useCallback(
    (saved: SavedMessage) => setWatchLater([saved.id], saved.watchDoneAt ? 'undone' : 'done'),
    [setWatchLater],
  );
  const remove = useCallback(
    (saved: SavedMessage) => {
      setWatchLater([saved.id], 'off');
      showNotice('Убрано из «Посмотреть позже»', 'info', {
        label: 'Вернуть',
        run: () => restoreWatchLater(saved),
      });
    },
    [restoreWatchLater, setWatchLater],
  );
  const openMenu = useCallback((saved: SavedMessage, anchor: MenuAnchor) => {
    frameRef.current?.measureInWindow((x, y, width, height) =>
      setViewport({ x, y, width, height }),
    );
    setMenu({ savedId: saved.id, anchor, tab: 'later' });
  }, []);

  const rowProps = (saved: SavedMessage) => ({
    saved,
    chat: saved.sourceChatId ? later.chats.get(saved.sourceChatId) : undefined,
    currentUserId,
    tagsById,
    mediaBounds,
    expanded: expanded.has(saved.id),
    onOpenSource: openSource,
  });

  const renderItem = ({ item }: { item: SavedMessage }) => (
    <WatchLaterRow
      {...rowProps(item)}
      sticky={sticky}
      onToggleExpanded={toggleExpanded}
      onToggleDone={toggleDone}
      onRemove={remove}
      onOpenMenu={openMenu}
    />
  );

  if (later.failed)
    return <LoadFailed message="Не удалось загрузить список" onRetry={later.reload} />;

  if (later.isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator accessibilityLabel="Загрузка списка" />
      </View>
    );
  }

  return (
    <View
      ref={frameRef}
      collapsable={false}
      style={styles.flex}
      onLayout={() => frameRef.current?.measureInWindow((_x, y) => listTop.set(y))}
    >
      {later.items.length === 0 ? (
        <View testID="watch-later-empty" style={styles.centered}>
          <Text variant="bodyBold">Список пуст</Text>
          <Text color="textSecondary" style={styles.hint}>
            Отметьте «Посмотреть позже» при сохранении или в меню сохранённого сообщения — оно
            появится здесь.
          </Text>
        </View>
      ) : (
        <Animated.FlatList
          testID="watch-later-list"
          data={later.items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          extraData={expanded}
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
      )}

      <SavedMenu
        target={menu}
        saved={menuSaved}
        viewport={viewport}
        preview={menuSaved ? <WatchLaterRowBody {...rowProps(menuSaved)} /> : null}
        previewGrowth="down"
        tags={tags}
        actions={handlers.actions}
        onAction={handlers.run}
        onClose={() => setMenu(null)}
      />
    </View>
  );
}
