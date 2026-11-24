import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { PixelRatio, useWindowDimensions, View } from 'react-native';

import type { Pop } from '@/api/pops';
import { InfoTabList } from '@/components/InfoPage';
import { TabStatus, tabStatusOf } from '@/features/chats/ChatInfoPage/TabStatus';
import { useOpenPopViewer } from '@/features/pops/openPopViewer';
import {
  POP_COLUMNS,
  popGridGeometry,
  toPopRows,
  type PopCell,
  type PopRow,
} from '@/features/pops/PopGrid/geometry';
import { PopGridRow, type PopGridActions } from '@/features/pops/PopGrid/PopGridRow';
import { popsQueryKey, usePops } from '@/features/pops/queries';
import { useTheme } from '@/hooks/use-theme';

/** Скелет до первой страницы — несколько рядов, больше экрана не нужно. */
const SKELETON_ROWS = 4;

const noop = () => undefined;

type Row = PopRow | { key: string; skeleton: true };

export type PopsTabProps = {
  tab: number;
  channelId: string;
};

/**
 * Вкладка «Попсы» страницы канала: та же сетка, что в разделе «Попсы», — три
 * колонки вертикальных обложек с длительностью и просмотрами, свежие сверху,
 * страницами. Без плитки «+» и попсов в пути: это витрина канала. Тап —
 * просмотр попсов канала с этого попа.
 */
export function PopsTab({ tab, channelId }: PopsTabProps) {
  const openPopViewer = useOpenPopViewer();
  const queryClient = useQueryClient();
  const { width } = useWindowDimensions();
  const geometry = useMemo(() => popGridGeometry(width, PixelRatio.get()), [width]);
  const pops = usePops(channelId);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = pops;

  const rows = useMemo<Row[]>(() => {
    if (pops.data === undefined) {
      return Array.from({ length: SKELETON_ROWS }, (_, at) => ({ key: `s${at}`, skeleton: true }));
    }

    const cells: PopCell[] = pops.data.pages.flat().map((pop) => ({ type: 'pop', pop }));

    return toPopRows(cells);
  }, [pops.data]);

  const open = useCallback(
    (pop: Pop) => openPopViewer({ source: 'channel', channelId, startId: pop.id }),
    [channelId, openPopViewer],
  );

  const actions = useMemo<PopGridActions>(
    () => ({
      onAdd: noop,
      onPop: open,
      showDuration: true,
      showViews: true,
      onRetry: noop,
      onDiscard: noop,
    }),
    [open],
  );

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const retry = useCallback(() => {
    if (pops.data === undefined) {
      void queryClient.resetQueries({ queryKey: popsQueryKey(channelId), exact: true });
    } else {
      void fetchNextPage();
    }
  }, [channelId, fetchNextPage, pops.data, queryClient]);

  return (
    <InfoTabList
      tab={tab}
      testID="info-pops"
      data={rows}
      keyExtractor={(row) => row.key}
      getItemType={(row) => ('skeleton' in row ? 'skeleton' : 'row')}
      renderItem={({ item }) =>
        'skeleton' in item ? (
          <SkeletonRow geometry={geometry} />
        ) : (
          <PopGridRow cells={item.cells} geometry={geometry} actions={actions} />
        )
      }
      onEndReached={loadMore}
      onEndReachedThreshold={1}
      footer={<TabStatus state={tabStatusOf(pops)} what="попсы" onRetry={retry} />}
    />
  );
}

/** Ряд-заглушка тех же размеров, что ряд попсов: вёрстка не прыгает. */
function SkeletonRow({ geometry }: { geometry: ReturnType<typeof popGridGeometry> }) {
  const theme = useTheme();

  return (
    <View testID="info-pops-skeleton" style={{ height: geometry.rowPitch }}>
      {Array.from({ length: POP_COLUMNS }, (_, column) => (
        <View
          key={column}
          style={{
            position: 'absolute',
            top: 0,
            left: geometry.columnLeft[column],
            width: geometry.cellWidth,
            height: geometry.cellHeight,
            backgroundColor: theme.backgroundElement,
          }}
        />
      ))}
    </View>
  );
}
