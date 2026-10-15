import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { TabStatus, tabStatusOf } from './TabStatus';
import { chatInfoKeys, useChatMedia } from './queries';

import type { ChatMediaItem } from '@/api/chatInfo';
import { AnchoredMenu, type MenuAnchor } from '@/components/AnchoredMenu';
import { InfoTabList } from '@/components/InfoPage';
import { Text } from '@/components/Text';
import { formatDuration, MediaViewer, type MediaViewerItem } from '@/features/media';
import { useTheme } from '@/hooks/use-theme';
import { InfoPageSizes, Radii, Spacing } from '@/theme';

const COLUMNS = InfoPageSizes.gridColumns;
const GAP = InfoPageSizes.gridGap;
/** Скелет до первой страницы — несколько рядов, больше экрана не нужно. */
const SKELETON_CELLS = COLUMNS * 6;
/** За столько медиа до конца загруженного просмотр просит следующую страницу. */
const VIEWER_PREFETCH = 5;

type Cell = { type: 'media'; item: ChatMediaItem } | { type: 'skeleton'; key: string };

export type MediaTabProps = {
  tab: number;
  chatId: string;
  onShowInChat: (messageId: string, createdAt: string) => void;
};

function isVideo(item: ChatMediaItem): boolean {
  return item.mimeType.startsWith('video/');
}

/**
 * Вкладка «Медиа»: фото и видео чата сеткой в четыре колонки, свежие сверху,
 * альбом — по клетке на вложение. Тап — просмотр с листанием по всем медиа
 * чата, долгое нажатие — «Показать в чате».
 */
export function MediaTab({ tab, chatId, onShowInChat }: MediaTabProps) {
  const queryClient = useQueryClient();
  const { width } = useWindowDimensions();
  const query = useChatMedia(chatId);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; item: ChatMediaItem } | null>(null);
  const size = (width - GAP * (COLUMNS - 1)) / COLUMNS;

  const cells = useMemo<Cell[]>(() => {
    const loaded: Cell[] = items.map((item) => ({ type: 'media', item }));
    const waiting = query.data === undefined ? SKELETON_CELLS : isFetchingNextPage ? COLUMNS : 0;
    const filler = (COLUMNS - (loaded.length % COLUMNS)) % COLUMNS;
    const count = waiting > 0 ? waiting + filler : 0;

    return [
      ...loaded,
      ...Array.from({ length: count }, (_, at) => ({ type: 'skeleton' as const, key: `s${at}` })),
    ];
  }, [isFetchingNextPage, items, query.data]);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const retry = useCallback(() => {
    if (query.data === undefined) {
      void queryClient.resetQueries({ queryKey: chatInfoKeys.media(chatId), exact: true });
    } else {
      void fetchNextPage();
    }
  }, [chatId, fetchNextPage, query.data, queryClient]);

  const viewerItems = useMemo<MediaViewerItem[]>(
    () =>
      items.map((item) => ({
        id: item.id,
        kind: isVideo(item) ? 'video' : 'photo',
        url: item.url,
        width: item.width,
        height: item.height,
      })),
    [items],
  );

  const onViewerIndex = useCallback(
    (index: number) => {
      if (index >= items.length - VIEWER_PREFETCH) loadMore();
    },
    [items.length, loadMore],
  );

  const open = useCallback(
    (item: ChatMediaItem) => setViewerIndex(items.findIndex((entry) => entry.id === item.id)),
    [items],
  );
  const openMenu = useCallback(
    (item: ChatMediaItem, anchor: MenuAnchor) => setMenu({ item, anchor }),
    [],
  );

  return (
    <>
      <InfoTabList
        tab={tab}
        testID="info-media"
        data={cells}
        numColumns={COLUMNS}
        keyExtractor={(cell) => (cell.type === 'media' ? cell.item.id : cell.key)}
        renderItem={({ item: cell, index }) => (
          <MediaCell
            cell={cell}
            size={size}
            column={index % COLUMNS}
            onPress={open}
            onLongPress={openMenu}
          />
        )}
        onEndReached={loadMore}
        onEndReachedThreshold={1}
        footer={<TabStatus state={tabStatusOf(query)} what="медиа" onRetry={retry} />}
      />

      <MediaViewer
        visible={viewerIndex !== null && viewerIndex >= 0}
        items={viewerItems}
        initialIndex={viewerIndex ?? 0}
        onClose={() => setViewerIndex(null)}
        onIndexChange={onViewerIndex}
      />

      <AnchoredMenu
        testID="info-media-menu"
        anchor={menu?.anchor ?? null}
        actions={SHOW_IN_CHAT}
        onSelect={() => {
          if (menu) onShowInChat(menu.item.messageId, menu.item.createdAt);
        }}
        onClosed={() => setMenu(null)}
      />
    </>
  );
}

export const SHOW_IN_CHAT = [
  {
    id: 'show' as const,
    label: 'Показать в чате',
    icon: { ios: 'text.bubble', android: 'chat', web: 'chat' } as const,
  },
];

type MediaCellProps = {
  cell: Cell;
  size: number;
  column: number;
  onPress: (item: ChatMediaItem) => void;
  onLongPress: (item: ChatMediaItem, anchor: MenuAnchor) => void;
};

/** Клетка сетки: квадратное превью, у видео — плашка с длительностью. */
const MediaCell = memo(function MediaCell({
  cell,
  size,
  column,
  onPress,
  onLongPress,
}: MediaCellProps) {
  const theme = useTheme();
  const ref = useRef<View>(null);
  // Колонка списка — четверть ширины, а клетка уже на зазоры: сдвиг внутри
  // колонки ставит её так, что зазоры между клетками ровные.
  const box = { width: size, height: size, marginLeft: (column * GAP) / 4, marginBottom: GAP };

  if (cell.type === 'skeleton') {
    return <View style={[box, { backgroundColor: theme.backgroundElement }]} />;
  }

  const { item } = cell;
  const video = isVideo(item);

  return (
    <Pressable
      ref={ref}
      testID="info-media-cell"
      accessibilityRole="imagebutton"
      accessibilityLabel={video ? 'Видео' : 'Фото'}
      onPress={() => onPress(item)}
      onLongPress={() =>
        ref.current?.measureInWindow((x, y, width, height) =>
          onLongPress(item, { x, y, width, height }),
        )
      }
      style={[box, { backgroundColor: theme.backgroundElement }]}
    >
      <Image
        source={{ uri: video ? (item.posterUrl ?? item.url) : item.url }}
        style={styles.fill}
        contentFit="cover"
        transition={CELL_FADE_MS}
        recyclingKey={item.id}
      />
      {video ? (
        <View style={[styles.badge, { backgroundColor: theme.mediaScrim }]}>
          <Text variant="meta" color="textOnMedia">
            {`▶ ${formatDuration(item.durationMs ?? 0)}`}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
});

/** Превью проявляется, а не выскакивает. */
const CELL_FADE_MS = 150;

const styles = StyleSheet.create({
  fill: {
    width: '100%',
    height: '100%',
  },
  badge: {
    position: 'absolute',
    left: Spacing.one,
    bottom: Spacing.one,
    paddingHorizontal: Spacing.one,
    borderRadius: Radii.sm,
  },
});
