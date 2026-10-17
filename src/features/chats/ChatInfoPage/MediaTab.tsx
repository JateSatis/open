import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';

import { TabStatus, tabStatusOf } from './TabStatus';
import { chatInfoKeys, useChatMedia } from './queries';

import type { ChatMediaItem } from '@/api/chatInfo';
import { AnchoredMenu, type MenuAnchor } from '@/components/AnchoredMenu';
import { InfoTabList, useInfoTabsViewport } from '@/components/InfoPage';
import { Text } from '@/components/Text';
import { formatDuration, MediaViewer, type MediaViewerItem } from '@/features/media';
import {
  createTileRegistry,
  measureView,
  TileViewportContext,
  useTileHidden,
  type TileRect,
  type TileRegistry,
} from '@/features/media/tileRegistry';
import { useTileTap } from '@/features/media/useTileTap';
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

/** Картинка клетки: у видео — постер. С неё же начинается перелёт в просмотр. */
function cellImageUri(item: ChatMediaItem): string {
  return isVideo(item) ? (item.posterUrl ?? item.url) : item.url;
}

type ViewerState = { index: number; origin: TileRect | null; armed: boolean };

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
  // `armed` — палец ещё на клетке: просмотр готовится, но стоит в ней.
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  // Клетки сетки по id медиа: просмотр уходит в клетку файла, на котором
  // закрыли. Клетки переиспользуются — снимаются сверкой вью.
  const [tiles] = useState(createTileRegistry);
  const tabsViewport = useInfoTabsViewport();
  const measureViewport = useCallback(async () => tabsViewport(), [tabsViewport]);
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
        thumbUrl: cellImageUri(item),
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

  const indexOf = useCallback(
    (item: ChatMediaItem) => items.findIndex((entry) => entry.id === item.id),
    [items],
  );
  const open = useCallback(
    (item: ChatMediaItem, origin: TileRect | null) => {
      const index = indexOf(item);

      if (index < 0) return;

      setViewer((current) =>
        current === null || current.armed ? { index, origin, armed: false } : current,
      );
    },
    [indexOf],
  );
  const arm = useCallback(
    (item: ChatMediaItem, origin: TileRect | null) => {
      const index = indexOf(item);

      if (index >= 0) setViewer((current) => current ?? { index, origin, armed: true });
    },
    [indexOf],
  );
  const disarm = useCallback(() => setViewer((current) => (current?.armed ? null : current)), []);
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
            tiles={tiles}
            onPress={open}
            onArm={arm}
            onDisarm={disarm}
            onLongPress={openMenu}
          />
        )}
        onEndReached={loadMore}
        onEndReachedThreshold={1}
        footer={<TabStatus state={tabStatusOf(query)} what="медиа" onRetry={retry} />}
      />

      <TileViewportContext.Provider value={measureViewport}>
        <MediaViewer
          // Другая клетка, чем под пальцем, — другой просмотр с нуля.
          key={viewer?.index}
          visible={viewer !== null}
          armed={viewer?.armed}
          items={viewerItems}
          initialIndex={viewer?.index ?? 0}
          origin={viewer?.origin}
          tiles={tiles}
          onClose={() => setViewer(null)}
          onIndexChange={onViewerIndex}
        />
      </TileViewportContext.Provider>

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
  tiles: TileRegistry;
  onPress: (item: ChatMediaItem, origin: TileRect | null) => void;
  /** Палец задержался на клетке — просмотр готовится; ушёл без тапа — не нужен. */
  onArm: (item: ChatMediaItem, origin: TileRect | null) => void;
  onDisarm: () => void;
  onLongPress: (item: ChatMediaItem, anchor: MenuAnchor) => void;
};

/** Клетка сетки: квадратное превью, у видео — плашка с длительностью. */
const MediaCell = memo(function MediaCell({
  cell,
  size,
  column,
  tiles,
  onPress,
  onArm,
  onDisarm,
  onLongPress,
}: MediaCellProps) {
  const theme = useTheme();
  // Колонка списка — четверть ширины, а клетка уже на зазоры: сдвиг внутри
  // колонки ставит её так, что зазоры между клетками ровные.
  const box = { width: size, height: size, marginLeft: (column * GAP) / 4, marginBottom: GAP };

  if (cell.type === 'skeleton') {
    return <View style={[box, { backgroundColor: theme.backgroundElement }]} />;
  }

  return (
    <MediaCellContent
      item={cell.item}
      box={box}
      tiles={tiles}
      onPress={onPress}
      onArm={onArm}
      onDisarm={onDisarm}
      onLongPress={onLongPress}
    />
  );
});

type MediaCellContentProps = Omit<MediaCellProps, 'cell' | 'size' | 'column'> & {
  item: ChatMediaItem;
  box: { width: number; height: number; marginLeft: number; marginBottom: number };
};

/**
 * Клетка с медиа. Тап — жест-обработчиком, чтобы срабатывать и на хвосте
 * прокрутки (см. `useTileTap`); пока медиа открыто в просмотре, клетка пуста.
 */
function MediaCellContent({
  item,
  box,
  tiles,
  onPress,
  onArm,
  onDisarm,
  onLongPress,
}: MediaCellContentProps) {
  const theme = useTheme();
  const ref = useRef<View>(null);
  const video = isVideo(item);
  const hidden = useTileHidden(item.id);

  // Клетку переиспользуют под другие медиа — запись в таблице меняется вместе с ним.
  useEffect(() => {
    const view = ref.current;

    tiles.register(item.id, view);

    return () => tiles.unregister(item.id, view);
  }, [item.id, tiles]);

  // Замер асинхронный: палец мог уйти раньше, чем клетка измерилась.
  const armToken = useRef(0);
  const open = useCallback(() => {
    armToken.current += 1;
    void measureView(ref.current).then((origin) => onPress(item, origin));
  }, [item, onPress]);
  const arm = useCallback(() => {
    const token = ++armToken.current;

    void measureView(ref.current).then((origin) => {
      if (armToken.current === token) onArm(item, origin);
    });
  }, [item, onArm]);
  const disarm = useCallback(() => {
    armToken.current += 1;
    onDisarm();
  }, [onDisarm]);
  const tap = useTileTap({ onTap: open, onArm: arm, onDisarm: disarm });

  return (
    <GestureDetector gesture={tap}>
      <Pressable
        ref={ref}
        testID="info-media-cell"
        accessibilityRole="imagebutton"
        accessibilityLabel={video ? 'Видео' : 'Фото'}
        onPress={open}
        onLongPress={() =>
          ref.current?.measureInWindow((x, y, width, height) =>
            onLongPress(item, { x, y, width, height }),
          )
        }
        style={[box, { backgroundColor: theme.backgroundElement }]}
      >
        <Image
          source={{ uri: cellImageUri(item) }}
          style={[styles.fill, hidden && styles.hidden]}
          contentFit="cover"
          transition={CELL_FADE_MS}
          recyclingKey={item.id}
        />
        {video && !hidden ? (
          <View style={[styles.badge, { backgroundColor: theme.mediaScrim }]}>
            <Text variant="meta" color="textOnMedia">
              {`▶ ${formatDuration(item.durationMs ?? 0)}`}
            </Text>
          </View>
        ) : null}
      </Pressable>
    </GestureDetector>
  );
}

/** Превью проявляется, а не выскакивает. */
const CELL_FADE_MS = 150;

const styles = StyleSheet.create({
  fill: {
    width: '100%',
    height: '100%',
  },
  hidden: {
    opacity: 0,
  },
  badge: {
    position: 'absolute',
    left: Spacing.one,
    bottom: Spacing.one,
    paddingHorizontal: Spacing.one,
    borderRadius: Radii.sm,
  },
});
