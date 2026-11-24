import { useRequestClient } from '@/features/auth/RequestClientContext';
import { useQueryClient } from '@tanstack/react-query';
import { FlashList, type FlashListProps, type ListRenderItem } from '@shopify/flash-list';
import { useCallback, useMemo, type ComponentType, type ReactElement } from 'react';
import { ActivityIndicator, PixelRatio, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { popGridGeometry, toPopRows, type PopCell, type PopRow } from './geometry';
import { PopGridRow, type PopGridActions } from './PopGridRow';
import { styles } from './styles';

import type { Pop } from '@/api/pops';
import { confirm } from '@/components/ConfirmDialog';
import { Text } from '@/components/Text';
import { useCurrentUserId } from '@/features/chats/useCurrentUserId';
import { usePendingPops, type PendingPop } from '@/features/pops/pendingPops';
import { discardPop, retryPop } from '@/features/pops/publishing';
import { usePops } from '@/features/pops/queries';
import { describeLoadError } from '@/lib/network';

export type { PopGridActions } from './PopGridRow';

/** Список, в котором рисуется сетка: обычный `FlashList` или список шита. */
export type PopListComponent = ComponentType<
  Pick<
    FlashListProps<PopRow>,
    | 'testID'
    | 'data'
    | 'keyExtractor'
    | 'renderItem'
    | 'getItemType'
    | 'contentContainerStyle'
    | 'onEndReached'
    | 'onEndReachedThreshold'
    | 'drawDistance'
    | 'ListEmptyComponent'
    | 'ListHeaderComponent'
    | 'ListFooterComponent'
  >
>;

export type PopGridProps = {
  channelId: string;
  /** Первая плитка «+» — у того, кто может публиковать. */
  canAdd: boolean;
  onAdd: () => void;
  addLabel?: string;
  onPop?: (pop: Pop) => void;
  /** Удержание на попе. */
  onPopLongPress?: (pop: Pop) => void;
  popsDisabled?: boolean;
  showDuration?: boolean;
  /** Просмотры внизу слева на плитках — в сетке канала, как в профиле TikTok. */
  showViews?: boolean;
  ListComponent?: PopListComponent;
  header?: ReactElement | null;
  footer?: ReactElement | null;
  minContentHeight?: number;
  testID?: string;
};

/**
 * Сетка попсов канала, как профиль в TikTok: три колонки вертикальных
 * обложек, новые сверху, подгрузка страницами. Первыми — «+» и попсы в пути.
 * Её же показывает вкладка «Pop» шита медиа, подставляя свой список.
 */
export function PopGrid({
  channelId,
  canAdd,
  onAdd,
  addLabel,
  onPop,
  onPopLongPress,
  popsDisabled,
  showDuration,
  showViews,
  ListComponent = FlashList,
  header = null,
  footer = null,
  minContentHeight = 0,
  testID = 'pop-grid',
}: PopGridProps) {
  const api = useRequestClient();
  const queryClient = useQueryClient();
  const userId = useCurrentUserId();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const geometry = useMemo(() => popGridGeometry(width, PixelRatio.get()), [width]);
  const pops = usePops(channelId);
  const pending = usePendingPops(channelId);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = pops;

  const rows = useMemo(() => {
    const cells: PopCell[] = [
      ...(canAdd ? [{ type: 'add' } as const] : []),
      ...pending.map((item) => ({ type: 'pending', pending: item }) as const),
      ...(pops.data?.pages.flat() ?? []).map((pop) => ({ type: 'pop', pop }) as const),
    ];

    return toPopRows(cells);
  }, [canAdd, pending, pops.data]);

  const onRetry = useCallback(
    (item: PendingPop) => {
      if (userId) retryPop(queryClient, userId, channelId, item.localId, api);
    },
    [api, channelId, queryClient, userId],
  );

  const onDiscard = useCallback(
    (item: PendingPop) => {
      void confirm({
        title: 'Убрать поп?',
        message: 'Он не опубликован и пропадёт.',
        confirmLabel: 'Убрать',
        cancelLabel: 'Отмена',
        destructive: true,
      }).then((yes) => {
        if (yes) discardPop(channelId, item.localId, api);
      });
    },
    [api, channelId],
  );

  const actions = useMemo<PopGridActions>(
    () => ({
      onAdd,
      addLabel,
      onPop,
      onPopLongPress,
      popsDisabled,
      showDuration,
      showViews,
      onRetry,
      onDiscard,
    }),
    [
      addLabel,
      onAdd,
      onDiscard,
      onPop,
      onPopLongPress,
      onRetry,
      popsDisabled,
      showDuration,
      showViews,
    ],
  );

  const renderItem = useCallback<ListRenderItem<PopRow>>(
    ({ item }) => <PopGridRow cells={item.cells} geometry={geometry} actions={actions} />,
    [actions, geometry],
  );
  const keyExtractor = useCallback((row: PopRow) => row.key, []);
  const getItemType = useCallback(() => 'row', []);
  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);
  // Сетка доходит до края окна: последний ряд докручивается над полосой навигации.
  const contentContainerStyle = useMemo(
    () => ({ minHeight: minContentHeight, paddingBottom: insets.bottom }),
    [insets.bottom, minContentHeight],
  );

  const loadError = describeLoadError(pops.error, 'Не удалось загрузить попсы');
  const empty = pops.isPending ? (
    <View style={styles.empty}>
      <ActivityIndicator accessibilityLabel="Загрузка попсов" />
    </View>
  ) : (
    <View style={styles.empty}>
      <Text color={loadError ? 'danger' : 'textSecondary'}>{loadError ?? 'Попсов пока нет'}</Text>
    </View>
  );

  const List = ListComponent;

  return (
    <List
      testID={testID}
      data={rows}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      getItemType={getItemType}
      contentContainerStyle={contentContainerStyle}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      drawDistance={geometry.rowPitch * 2}
      ListEmptyComponent={empty}
      ListHeaderComponent={header}
      ListFooterComponent={
        footer ??
        (isFetchingNextPage ? (
          <View style={styles.footer}>
            <ActivityIndicator accessibilityLabel="Загрузка попсов" />
          </View>
        ) : null)
      }
    />
  );
}
